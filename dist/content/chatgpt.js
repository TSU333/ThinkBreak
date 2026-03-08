(() => {
  if (window.__aiWaitModeChatGptDetector) {
    return;
  }

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
  const POLL_INTERVAL_MS = 500;
  const REPORT_HEARTBEAT_MS = 1000;
  const STATE_DEBOUNCE_MS = 500;
  const MIN_GENERATION_MS = 1000;
  const TEXT_SILENCE_MS = 2500;
  const RECENT_USER_ACTIVITY_MS = 6000;
  const RECENT_STREAM_ACTIVITY_MS = 1800;
  const GENERATING_STICKY_MS = 5000;
  const FINISH_GRACE_WINDOW_MS = 30000;

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const styles = window.getComputedStyle(element);
    return styles.display !== "none" && styles.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function isEditable(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (!isVisible(element)) {
      return false;
    }

    const ariaDisabled = element.getAttribute("aria-disabled");
    const disabled = "disabled" in element ? element.disabled : false;
    return !disabled && ariaDisabled !== "true";
  }

  function hasKeyword(text, keywords) {
    const normalized = normalizeText(text).toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
  }

  function findButtonByKeywords(keywords) {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) {
      const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
        .filter(Boolean)
        .join(" ");

      if (hasKeyword(text, keywords) && isVisible(button)) {
        return button;
      }
    }

    return null;
  }

  class TextStabilityTracker {
    constructor() {
      this.lastHash = "";
      this.lastLength = 0;
      this.lastChangedAt = 0;
    }

    update(text, now = Date.now()) {
      const hash = this.hashText(text);
      const length = text.length;
      const changed = hash !== this.lastHash || length !== this.lastLength;

      if (changed) {
        this.lastHash = hash;
        this.lastLength = length;
        this.lastChangedAt = now;
      } else if (this.lastChangedAt === 0) {
        this.lastChangedAt = now;
      }

      return { changed, hash, length };
    }

    stableFor(now = Date.now()) {
      if (this.lastChangedAt === 0) {
        return 0;
      }

      return now - this.lastChangedAt;
    }

    changedWithin(ms, now = Date.now()) {
      return now - this.lastChangedAt <= ms;
    }

    hashText(text) {
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash << 5) - hash + text.charCodeAt(index);
        hash |= 0;
      }

      return String(hash);
    }
  }

  class DetectorBase {
    constructor(platform, reporter) {
      this.platform = platform;
      this.reporter = reporter;
      this.observer = null;
      this.pollHandle = null;
      this.currentState = "UNKNOWN";
      this.pendingState = "UNKNOWN";
      this.pendingSince = 0;
      this.lastReason = "";
      this.lastReportAt = 0;
      this.generatingSince = null;
    }

    init() {
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

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (this.pollHandle !== null) {
        clearInterval(this.pollHandle);
        this.pollHandle = null;
      }
    }

    getCurrentState() {
      return this.currentState;
    }

    debug(message) {
      this.reporter({
        type: "DEBUG_LOG",
        payload: `[${this.platform}] ${message}`
      });
    }

    getGeneratingDuration(now = Date.now()) {
      if (this.generatingSince === null) {
        return 0;
      }

      return now - this.generatingSince;
    }

    tick(origin) {
      const snapshot = this.evaluate();
      const now = Date.now();
      const nextState = this.enforceStateRules(snapshot.state, now);

      if (snapshot.reason !== this.lastReason) {
        this.lastReason = snapshot.reason;
        this.debug(`${origin} -> ${nextState} (${snapshot.reason})`);
      }

      if (nextState !== this.pendingState) {
        this.pendingState = nextState;
        this.pendingSince = now;
      }

      if (nextState !== this.currentState && now - this.pendingSince >= STATE_DEBOUNCE_MS) {
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

        this.sendState(nextState, snapshot);
        return;
      }

      if (this.currentState === "GENERATING" && now - this.lastReportAt >= REPORT_HEARTBEAT_MS) {
        this.sendState(this.currentState, snapshot);
      }
    }

    enforceStateRules(state, now) {
      if (state === "FINISHED" && this.generatingSince !== null && now - this.generatingSince < MIN_GENERATION_MS) {
        return "GENERATING";
      }

      return state;
    }

    sendState(state, snapshot) {
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

  class ChatGptDetector extends DetectorBase {
    constructor(reporter) {
      super("chatgpt", reporter);
      this.textTracker = new TextStabilityTracker();
      this.lastUserCount = 0;
      this.lastStrongGeneratingSignalAt = 0;
      this.lastUserActivityAt = 0;
      this.hasSeededConversation = false;
      this.hasSeededAssistantSnapshot = false;
      this.clickHandler = (event) => {
        const button = event.target && event.target.closest ? event.target.closest("button") : null;
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
      this.keydownHandler = (event) => {
        const target = event.target;
        if (!target) {
          return;
        }

        const isPromptSurface =
          target.matches &&
          (target.matches("#prompt-textarea, textarea[data-testid='prompt-textarea']") ||
            (target.closest && target.closest("#prompt-textarea, textarea[data-testid='prompt-textarea']")));

        if (isPromptSurface && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          this.lastUserActivityAt = Date.now();
        }
      };
    }

    init() {
      document.addEventListener("click", this.clickHandler, true);
      document.addEventListener("keydown", this.keydownHandler, true);
      super.init();
    }

    destroy() {
      document.removeEventListener("click", this.clickHandler, true);
      document.removeEventListener("keydown", this.keydownHandler, true);
      super.destroy();
    }

    evaluate() {
      const now = Date.now();
      const userMessages = this.getMessages("user");
      const assistantMessages = this.getMessages("assistant");

      if (this.hasSeededConversation && userMessages.length > this.lastUserCount) {
        this.lastUserActivityAt = now;
      }
      this.lastUserCount = userMessages.length;
      this.hasSeededConversation = true;

      const lastAssistant = assistantMessages.at(-1) || null;
      const lastAssistantText = normalizeText(lastAssistant ? lastAssistant.textContent : "");
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

      let state = "UNKNOWN";
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

    getMessages(role) {
      return Array.from(document.querySelectorAll(`[data-message-author-role="${role}"]`));
    }

    hasCompletionUi() {
      return Boolean(findButtonByKeywords(COMPLETION_BUTTON_KEYWORDS));
    }

    isInputReady() {
      const prompt =
        document.querySelector("#prompt-textarea") ||
        document.querySelector("textarea[data-testid='prompt-textarea']") ||
        document.querySelector("[contenteditable='true'][id='prompt-textarea']");

      return isEditable(prompt);
    }

    hasBusyRegion() {
      return Boolean(document.querySelector("[aria-busy='true']"));
    }
  }

  const sendMessage = (message) => {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      // Ignore transient worker wake-up failures.
    }
  };

  const detector = new ChatGptDetector(sendMessage);
  detector.init();
  window.__aiWaitModeChatGptDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeChatGptDetector;
  });
})();
