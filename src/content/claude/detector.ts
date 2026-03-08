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
import { TextStabilityTracker } from "../shared/stability";
import type { DetectorSnapshot } from "../shared/types";

const STOP_BUTTON_KEYWORDS = ["stop response", "cancel response", "停止响应"];
const COMPLETION_BUTTON_KEYWORDS = [
  "copy",
  "retry",
  "edit",
  "good response",
  "bad response",
  "复制",
  "重试"
];

const INPUT_SELECTORS = [
  "div.ProseMirror[contenteditable='true']",
  "div[contenteditable='true'][role='textbox']",
  "textarea"
];
const USER_MESSAGE_SELECTORS = [
  "[data-testid='user-message']",
  "[data-testid*='user-message']",
  "[data-role='user']",
  "[data-author='human']"
];
const ASSISTANT_MESSAGE_SELECTORS = [
  "[data-testid='assistant-message']",
  "[data-testid*='assistant-message']",
  "[data-role='assistant']",
  "[data-author='assistant']"
];
const BUSY_SELECTORS = [
  "[aria-busy='true']",
  "[data-is-streaming='true']",
  "[data-testid='typing-indicator']"
];
const FALLBACK_MESSAGE_SELECTORS = [
  "main article",
  "main [role='article']",
  "main [role='listitem']",
  "main section",
  "main div[data-testid]"
];

const TEXT_SILENCE_MS = 2500;
const RECENT_USER_ACTIVITY_MS = 6000;
const RECENT_STREAM_ACTIVITY_MS = 1800;
const GENERATING_STICKY_MS = 5000;
const FINISH_GRACE_WINDOW_MS = 30000;

export class ClaudeDetector extends DetectorBase {
  private textTracker = new TextStabilityTracker();
  private lastStrongGeneratingSignalAt = 0;
  private lastUserActivityAt = 0;
  private hasSeededAssistantSnapshot = false;

  private clickHandler = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    if (!button) {
      return;
    }

    const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ");

    if (hasKeyword(text, ["send", "send message", "发送"])) {
      this.lastUserActivityAt = Date.now();
    }
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
    super("claude", reporter);
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
    const userMessages = queryAllBySelectors(USER_MESSAGE_SELECTORS);
    const assistantMessages = this.getAssistantMessages();

    const lastAssistant = assistantMessages.at(-1) ?? null;
    const lastAssistantText = normalizeText(lastAssistant?.textContent);
    const textSnapshot = this.textTracker.update(lastAssistantText, now);
    const assistantChanging =
      this.hasSeededAssistantSnapshot &&
      (textSnapshot.changed || this.textTracker.changedWithin(RECENT_STREAM_ACTIVITY_MS, now));
    this.hasSeededAssistantSnapshot = true;

    const hasStopButton = Boolean(findButtonByKeywords(STOP_BUTTON_KEYWORDS));
    const hasCompletionUi = Boolean(findButtonByKeywords(COMPLETION_BUTTON_KEYWORDS));
    const inputReady = this.isInputReady();
    const hasBusyRegion = Boolean(queryFirstBySelectors(BUSY_SELECTORS));
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

    if (hasStopButton || busyGenerating || streamingLikely) {
      this.lastStrongGeneratingSignalAt = now;
    }

    let state: AIPageState = "UNKNOWN";
    let reason = "claude detector is waiting for stronger evidence";

    if (!hasConversation) {
      state = "IDLE";
      reason = "no Claude conversation nodes were found";
    } else if (completionLikely) {
      state = "FINISHED";
      reason = "Claude response text stayed stable and composer is ready";
    } else if (hasStopButton || busyGenerating || streamingLikely || stickyGenerating) {
      state = "GENERATING";
      reason = `Claude generation signals busy=${String(busyGenerating)} sticky=${String(stickyGenerating)}`;
    } else if (!hasStopButton && !assistantChanging && !recentUserActivity) {
      state = "IDLE";
      reason = "Claude conversation is stable with no active generation signal";
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
    return findTextHeavyElements(FALLBACK_MESSAGE_SELECTORS).filter((element) => !prompt || !element.contains(prompt));
  }
}
