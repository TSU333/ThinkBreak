import type { AIPageState, ContentToBackgroundMessage } from "../../common/messaging";
import { DetectorBase } from "../shared/detectorBase";
import { findButtonByKeywords, hasKeyword, isEditable, normalizeText } from "../shared/domUtils";
import { TextStabilityTracker } from "../shared/stability";
import type { DetectorSnapshot } from "../shared/types";

const STOP_BUTTON_KEYWORDS = ["stop generating", "stop streaming", "停止生成", "停止流式传输"];
const COMPLETION_BUTTON_KEYWORDS = [
  "copy",
  "regenerate",
  "retry",
  "thumbs up",
  "thumbs down",
  "good response",
  "bad response",
  "复制",
  "重新生成"
];

const TEXT_SILENCE_MS = 2500;
const RECENT_USER_ACTIVITY_MS = 6000;
const RECENT_STREAM_ACTIVITY_MS = 1800;
const GENERATING_STICKY_MS = 5000;
const FINISH_GRACE_WINDOW_MS = 30000;

export class ChatGptDetector extends DetectorBase {
  private textTracker = new TextStabilityTracker();
  private lastUserCount = 0;
  private lastStrongGeneratingSignalAt = 0;
  private lastUserActivityAt = 0;
  private hasSeededConversation = false;
  private hasSeededAssistantSnapshot = false;
  private clickHandler = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    if (!button) {
      return;
    }

    const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ");

    if (hasKeyword(text, ["send", "submit", "发送"])) {
      this.lastUserActivityAt = Date.now();
    }
  };

  private keydownHandler = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const isPromptSurface =
      target.matches("#prompt-textarea, textarea[data-testid='prompt-textarea']") ||
      target.closest("#prompt-textarea, textarea[data-testid='prompt-textarea']");

    if (isPromptSurface && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      this.lastUserActivityAt = Date.now();
    }
  };

  constructor(reporter: (message: ContentToBackgroundMessage) => void) {
    super("chatgpt", reporter);
  }

  init(): void {
    document.addEventListener("click", this.clickHandler, true);
    document.addEventListener("keydown", this.keydownHandler, true);
    super.init();
  }

  destroy(): void {
    document.removeEventListener("click", this.clickHandler, true);
    document.removeEventListener("keydown", this.keydownHandler, true);
    super.destroy();
  }

  protected evaluate(): DetectorSnapshot {
    const now = Date.now();
    const userMessages = this.getMessages("user");
    const assistantMessages = this.getMessages("assistant");

    if (this.hasSeededConversation && userMessages.length > this.lastUserCount) {
      this.lastUserActivityAt = now;
    }
    this.lastUserCount = userMessages.length;
    this.hasSeededConversation = true;

    const lastAssistant = assistantMessages.at(-1) ?? null;
    const lastAssistantText = normalizeText(lastAssistant?.textContent);
    const textSnapshot = this.textTracker.update(lastAssistantText, now);
    const assistantChanging =
      this.hasSeededAssistantSnapshot &&
      (textSnapshot.changed || this.textTracker.changedWithin(RECENT_STREAM_ACTIVITY_MS, now));
    this.hasSeededAssistantSnapshot = true;

    const hasStopButton = Boolean(findButtonByKeywords(STOP_BUTTON_KEYWORDS));
    const hasCompletionUi = this.hasCompletionUi();
    const inputReady = this.isInputReady();
    const hasBusyRegion = this.hasBusyRegion();
    const recentUserActivity = now - this.lastUserActivityAt <= RECENT_USER_ACTIVITY_MS;
    const hasConversation = userMessages.length > 0 || assistantMessages.length > 0;
    const generatingSticky =
      this.getCurrentState() === "GENERATING" && now - this.lastStrongGeneratingSignalAt <= GENERATING_STICKY_MS;
    const busyGenerating = hasBusyRegion && (recentUserActivity || assistantChanging || generatingSticky);
    const streamingLikely =
      assistantChanging && (recentUserActivity || hasBusyRegion || this.getGeneratingDuration(now) > 0);
    const completionLikely =
      now - this.lastStrongGeneratingSignalAt <= FINISH_GRACE_WINDOW_MS &&
      !hasStopButton &&
      !hasBusyRegion &&
      this.textTracker.stableFor(now) >= TEXT_SILENCE_MS &&
      inputReady &&
      (hasCompletionUi || !assistantChanging);
    const stickyGenerating = generatingSticky && !completionLikely;
    const generatingSignals = [hasStopButton, busyGenerating, streamingLikely, recentUserActivity].filter(Boolean)
      .length;

    if (hasStopButton || busyGenerating || streamingLikely) {
      this.lastStrongGeneratingSignalAt = now;
    }

    let state: AIPageState = "UNKNOWN";
    let reason = "detector is waiting for stronger evidence";

    if (!hasConversation) {
      state = "IDLE";
      reason = "no conversation nodes were found";
    } else if (completionLikely) {
      state = "FINISHED";
      reason = "assistant text stayed stable and composer is ready";
    } else if (
      hasStopButton ||
      busyGenerating ||
      streamingLikely ||
      stickyGenerating
    ) {
      state = "GENERATING";
      reason = `generation signals=${generatingSignals}, busy=${String(busyGenerating)}, sticky=${String(stickyGenerating)}`;
    } else if (!hasStopButton && !assistantChanging && !recentUserActivity) {
      state = "IDLE";
      reason = "conversation is stable with no active generation signal";
    }

    return {
      state,
      reason,
      meta: {
        textHash: textSnapshot.hash,
        textLength: textSnapshot.length
      }
    };
  }

  private getMessages(role: "user" | "assistant"): HTMLElement[] {
    // ChatGPT has historically kept `data-message-author-role` stable even when class names churn.
    return Array.from(document.querySelectorAll<HTMLElement>(`[data-message-author-role="${role}"]`));
  }

  private hasCompletionUi(): boolean {
    return Boolean(findButtonByKeywords(COMPLETION_BUTTON_KEYWORDS));
  }

  private isInputReady(): boolean {
    // Prefer semantic prompt surfaces over layout classes.
    const prompt =
      document.querySelector("#prompt-textarea") ??
      document.querySelector("textarea[data-testid='prompt-textarea']") ??
      document.querySelector("[contenteditable='true'][id='prompt-textarea']");

    return isEditable(prompt);
  }

  private hasBusyRegion(): boolean {
    // `aria-busy` is one of the few semantic hints that survives frequent ChatGPT layout changes.
    return Boolean(document.querySelector("[aria-busy='true']"));
  }
}
