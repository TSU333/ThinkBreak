import type { AIPageState, ContentToBackgroundMessage, PlatformId } from "../../common/messaging";
import type { Detector, DetectorSnapshot } from "./types";

const POLL_INTERVAL_MS = 500;
const REPORT_HEARTBEAT_MS = 1000;
const STATE_DEBOUNCE_MS = 500;
const MIN_GENERATION_MS = 1000;
const POST_GENERATING_COOLDOWN_MS = 5000;

type Reporter = (message: ContentToBackgroundMessage) => void;

export abstract class DetectorBase implements Detector {
  readonly platform: PlatformId;

  private observer: MutationObserver | null = null;
  private pollHandle: number | null = null;
  private currentState: AIPageState = "UNKNOWN";
  private pendingState: AIPageState = "UNKNOWN";
  private pendingSince = 0;
  private lastReason = "";
  private lastReportAt = 0;
  private generatingSince: number | null = null;
  private postGeneratingStateUntil = 0;

  constructor(platform: PlatformId, private reporter: Reporter) {
    this.platform = platform;
  }

  init(): void {
    this.tick("init");

    this.observer = new MutationObserver(() => {
      this.tick("mutation");
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.pollHandle = window.setInterval(() => {
      this.tick("poll");
    }, POLL_INTERVAL_MS);
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  getCurrentState(): AIPageState {
    return this.currentState;
  }

  protected abstract evaluate(): DetectorSnapshot;

  protected debug(message: string): void {
    this.reporter({
      type: "DEBUG_LOG",
      payload: `[${this.platform}] ${message}`
    });
  }

  protected getGeneratingDuration(now = Date.now()): number {
    if (this.generatingSince === null) {
      return 0;
    }

    return now - this.generatingSince;
  }

  private tick(origin: string): void {
    const snapshot = this.evaluate();
    const now = Date.now();
    const nextState = this.enforceStateRules(snapshot.state, now);

    const reasonChanged = snapshot.reason !== this.lastReason;
    if (reasonChanged) {
      this.lastReason = snapshot.reason;
      this.debug(`${origin} -> ${nextState} (${snapshot.reason})`);
    }

    if (nextState !== this.pendingState) {
      this.pendingState = nextState;
      this.pendingSince = now;
    }

    if (nextState !== this.currentState && now - this.pendingSince >= STATE_DEBOUNCE_MS) {
      const previousState = this.currentState;
      this.currentState = nextState;

      if (nextState === "GENERATING" && this.generatingSince === null) {
        this.generatingSince = now;
      }

      if (nextState !== "GENERATING" && nextState !== "FINISHED") {
        this.generatingSince = null;
      }

      if (nextState === "FINISHED") {
        this.generatingSince = null;
      }

      if (previousState === "GENERATING" && (nextState === "IDLE" || nextState === "UNKNOWN")) {
        this.postGeneratingStateUntil = now + POST_GENERATING_COOLDOWN_MS;
      } else if (nextState === "GENERATING" || nextState === "FINISHED") {
        this.postGeneratingStateUntil = 0;
      }

      this.sendState(nextState, snapshot);
      return;
    }

    if (this.currentState === "GENERATING" && now - this.lastReportAt >= REPORT_HEARTBEAT_MS) {
      this.sendState(this.currentState, snapshot);
      return;
    }

    if (
      (this.currentState === "IDLE" || this.currentState === "UNKNOWN") &&
      now < this.postGeneratingStateUntil &&
      now - this.lastReportAt >= REPORT_HEARTBEAT_MS
    ) {
      this.sendState(this.currentState, snapshot);
    }
  }

  private enforceStateRules(state: AIPageState, now: number): AIPageState {
    if (state === "FINISHED" && this.generatingSince !== null && now - this.generatingSince < MIN_GENERATION_MS) {
      return "GENERATING";
    }

    return state;
  }

  private sendState(state: AIPageState, snapshot: DetectorSnapshot): void {
    this.lastReportAt = Date.now();
    this.reporter({
      type: "AI_STATE_CHANGED",
      platform: this.platform,
      state,
      timestamp: this.lastReportAt,
      meta: snapshot.meta
    });
  }
}
