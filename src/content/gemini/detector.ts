import type { AIPageState, ContentToBackgroundMessage } from "../../common/messaging";
import { DetectorBase } from "../shared/detectorBase";
import {
  findButtonByKeywords,
  findTextHeavyElements,
  hasKeyword,
  isEditable,
  normalizeText,
  queryAllBySelectors,
  queryFirstBySelectors
} from "../shared/domUtils";
import { installNetworkProbe, isPageProbeEvent } from "../shared/pageActivity";
import { TextStabilityTracker } from "../shared/stability";
import type { DetectorSnapshot } from "../shared/types";

const STOP_BUTTON_KEYWORDS = ["stop response", "stop generating", "停止响应", "停止生成"];
const COMPLETION_BUTTON_KEYWORDS = [
  "copy",
  "retry",
  "double-check response",
  "check response",
  "show drafts",
  "thumbs up",
  "thumbs down",
  "复制",
  "重试"
];

const INPUT_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true'][aria-label]",
  "div[contenteditable='true'][data-placeholder]",
  "div.ql-editor[contenteditable='true']",
  "rich-textarea div[contenteditable='true']",
  "rich-textarea textarea",
  "ms-autosize-textarea textarea"
];
const USER_MESSAGE_SELECTORS = [
  "[data-testid*='user']",
  "[data-test-id*='user']",
  "[data-message-author='user']",
  "[data-turn-role='user']",
  "[data-query-id]"
];
const ASSISTANT_MESSAGE_SELECTORS = [
  "[data-testid*='model-response']",
  "[data-test-id*='model-response']",
  "[data-message-author='model']",
  "[data-turn-role='model']",
  "[data-response-id]"
];
const BUSY_SELECTORS = [
  "[aria-busy='true']",
  "[role='progressbar']",
  "[aria-label*='thinking' i]",
  "[aria-label*='responding' i]",
  "[aria-label*='generating' i]",
  "[data-testid='loading-indicator']",
  "[data-test-id='loading-indicator']"
];
const FALLBACK_MESSAGE_SELECTORS = [
  "main article",
  "[role='main'] article",
  "main [role='article']",
  "main [role='listitem']",
  "main section",
  "[role='main'] section",
  "main div[data-response-id]",
  "main div[data-testid]",
  "main div[dir='auto']",
  "main [data-turn-role]",
  "main [data-message-author]"
];

const TEXT_SILENCE_MS = 2500;
const RECENT_USER_ACTIVITY_MS = 6000;
const RECENT_STREAM_ACTIVITY_MS = 1800;
const GENERATING_STICKY_MS = 5000;
const FINISH_GRACE_WINDOW_MS = 30000;
const NETWORK_ACTIVITY_MS = 2500;
const NETWORK_PROBE_KEYWORDS = ["bard", "gemini", "assistant", "generate", "stream", "conversation"];

export class GeminiDetector extends DetectorBase {
  private textTracker = new TextStabilityTracker();
  private transcriptTracker = new TextStabilityTracker();
  private lastStrongGeneratingSignalAt = 0;
  private lastUserActivityAt = 0;
  private activeProbeRequests = 0;
  private lastProbeActivityAt = 0;
  private hasSeededAssistantSnapshot = false;
  private hasSeededTranscriptSnapshot = false;

  private clickHandler = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest("button, [role='button']");
    if (!button) {
      return;
    }

    const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ");

    if (hasKeyword(text, ["send message", "send", "submit", "发送"])) {
      this.lastUserActivityAt = Date.now();
    }
  };

  private submitHandler = () => {
    this.lastUserActivityAt = Date.now();
  };

  private messageHandler = (event: MessageEvent) => {
    if (!isPageProbeEvent(event, "gemini")) {
      return;
    }

    this.lastProbeActivityAt = event.data.timestamp;

    if (event.data.kind === "REQUEST_START") {
      this.activeProbeRequests += 1;
      this.debug(`page probe matched ${event.data.method} ${event.data.url}`);
      return;
    }

    this.activeProbeRequests = Math.max(0, this.activeProbeRequests - 1);
  };

  private keydownHandler = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (this.isPromptSurface(target) && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      this.lastUserActivityAt = Date.now();
    }
  };

  constructor(reporter: (message: ContentToBackgroundMessage) => void) {
    super("gemini", reporter);
  }

  init(): void {
    installNetworkProbe("gemini", NETWORK_PROBE_KEYWORDS, { trackSameOrigin: true });
    document.addEventListener("click", this.clickHandler, true);
    document.addEventListener("keydown", this.keydownHandler, true);
    document.addEventListener("submit", this.submitHandler, true);
    window.addEventListener("message", this.messageHandler);
    super.init();
  }

  destroy(): void {
    document.removeEventListener("click", this.clickHandler, true);
    document.removeEventListener("keydown", this.keydownHandler, true);
    document.removeEventListener("submit", this.submitHandler, true);
    window.removeEventListener("message", this.messageHandler);
    super.destroy();
  }

  protected evaluate(): DetectorSnapshot {
    const now = Date.now();
    const userMessages = queryAllBySelectors(USER_MESSAGE_SELECTORS);
    const assistantMessages = this.getAssistantMessages();

    const lastAssistant = assistantMessages.at(-1) ?? null;
    const lastAssistantText = normalizeText(lastAssistant?.textContent);
    const textSnapshot = this.textTracker.update(lastAssistantText, now);
    const transcriptText = assistantMessages.map((message) => normalizeText(message.textContent)).join("\n");
    const transcriptSnapshot = this.transcriptTracker.update(transcriptText, now);
    const assistantChanging =
      this.hasSeededAssistantSnapshot &&
      (textSnapshot.changed || this.textTracker.changedWithin(RECENT_STREAM_ACTIVITY_MS, now));
    const transcriptChanging =
      this.hasSeededTranscriptSnapshot &&
      (transcriptSnapshot.changed || this.transcriptTracker.changedWithin(RECENT_STREAM_ACTIVITY_MS, now));
    this.hasSeededAssistantSnapshot = true;
    this.hasSeededTranscriptSnapshot = true;

    const hasStopButton = Boolean(findButtonByKeywords(STOP_BUTTON_KEYWORDS));
    const hasCompletionUi = Boolean(findButtonByKeywords(COMPLETION_BUTTON_KEYWORDS));
    const inputReady = this.isInputReady();
    const hasBusyRegion = Boolean(queryFirstBySelectors(BUSY_SELECTORS));
    const recentUserActivity = now - this.lastUserActivityAt <= RECENT_USER_ACTIVITY_MS;
    const hasNetworkActivity =
      this.activeProbeRequests > 0 || (this.lastProbeActivityAt > 0 && now - this.lastProbeActivityAt <= NETWORK_ACTIVITY_MS);
    const hasConversation =
      userMessages.length > 0 ||
      assistantMessages.length > 0 ||
      recentUserActivity ||
      this.getCurrentState() === "GENERATING";
    const generatingSticky =
      this.getCurrentState() === "GENERATING" && now - this.lastStrongGeneratingSignalAt <= GENERATING_STICKY_MS;
    const generatingContext =
      recentUserActivity || hasStopButton || generatingSticky || this.getGeneratingDuration(now) > 0;
    const streamChanging = assistantChanging || transcriptChanging;
    const busyGenerating =
      hasBusyRegion && generatingContext && (streamChanging || hasNetworkActivity || recentUserActivity || hasStopButton);
    const networkGenerating = recentUserActivity && hasNetworkActivity;
    const streamingLikely =
      streamChanging &&
      (generatingContext || networkGenerating);
    const completionSurfaceReady = inputReady || hasCompletionUi || transcriptSnapshot.length >= 80;
    const forcedCompletionStable = this.transcriptTracker.stableFor(now) >= TEXT_SILENCE_MS * 2;
    const completionLikely =
      now - this.lastStrongGeneratingSignalAt <= FINISH_GRACE_WINDOW_MS &&
      !hasStopButton &&
      this.textTracker.stableFor(now) >= TEXT_SILENCE_MS &&
      this.transcriptTracker.stableFor(now) >= TEXT_SILENCE_MS &&
      completionSurfaceReady &&
      !streamChanging &&
      transcriptSnapshot.length > 0 &&
      (!hasBusyRegion || !hasNetworkActivity || hasCompletionUi || forcedCompletionStable);
    const stickyGenerating = generatingSticky && !completionLikely;

    if (hasStopButton || busyGenerating || streamingLikely || networkGenerating) {
      this.lastStrongGeneratingSignalAt = now;
    }

    let state: AIPageState = "UNKNOWN";
    let reason = "gemini detector is waiting for stronger evidence";

    if (completionLikely) {
      state = "FINISHED";
      reason = "Gemini response text stayed stable and composer is ready";
    } else if (hasStopButton || busyGenerating || streamingLikely || networkGenerating || stickyGenerating) {
      state = "GENERATING";
      reason =
        `Gemini generation signals stop=${String(hasStopButton)} busy=${String(busyGenerating)} ` +
        `stream=${String(streamChanging)} network=${String(networkGenerating)} sticky=${String(stickyGenerating)}`;
    } else if (!hasConversation) {
      state = "IDLE";
      reason = "no Gemini conversation nodes were found";
    } else if (!hasStopButton && !streamChanging && !recentUserActivity) {
      state = "IDLE";
      reason = "Gemini conversation is stable with no active generation signal";
    }

    return {
      state,
      reason,
      meta: {
        textHash: transcriptSnapshot.hash,
        textLength: transcriptSnapshot.length
      }
    };
  }

  private isPromptSurface(target: HTMLElement): boolean {
    return INPUT_SELECTORS.some((selector) => target.matches(selector) || Boolean(target.closest(selector)));
  }

  private isInputReady(): boolean {
    return isEditable(queryFirstBySelectors(INPUT_SELECTORS));
  }

  private getAssistantMessages(): HTMLElement[] {
    const directMatches = queryAllBySelectors(ASSISTANT_MESSAGE_SELECTORS);
    if (directMatches.length > 0) {
      return directMatches;
    }

    const prompt = queryFirstBySelectors(INPUT_SELECTORS);
    return findTextHeavyElements(FALLBACK_MESSAGE_SELECTORS, 24).filter(
      (element) => !prompt || !element.contains(prompt)
    );
  }
}
