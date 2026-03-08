(() => {
  if (window.__aiWaitModeClaudeDetector) {
    return;
  }

  const STOP_BUTTON_KEYWORDS = ["stop response", "cancel response", "停止响应"];
  const COMPLETION_BUTTON_KEYWORDS = ["copy", "retry", "edit", "good response", "bad response", "复制", "重试"];
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
  const BUSY_SELECTORS = ["[aria-busy='true']", "[data-is-streaming='true']", "[data-testid='typing-indicator']"];
  const FALLBACK_MESSAGE_SELECTORS = [
    "main article",
    "main [role='article']",
    "main [role='listitem']",
    "main section",
    "main div[data-testid]"
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
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
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

  function queryOne(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        return element;
      }
    }

    return null;
  }

  function queryAll(selectors) {
    const seen = new Set();
    const results = [];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        if (!(element instanceof HTMLElement) || seen.has(element)) {
          continue;
        }

        seen.add(element);
        results.push(element);
      }
    }

    return results;
  }

  function findTextHeavyElements(selectors, minLength = 48) {
    return queryAll(selectors)
      .filter((element) => {
        if (!isVisible(element) || element.closest("form, nav, header, footer, aside, button")) {
          return false;
        }

        return normalizeText(element.textContent).length >= minLength;
      })
      .filter((element, index, elements) => {
        return !elements.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(element));
      });
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
      return this.lastChangedAt === 0 ? 0 : now - this.lastChangedAt;
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
      this.currentState = "UNKNOWN";
      this.pendingState = "UNKNOWN";
      this.pendingSince = 0;
      this.lastReason = "";
      this.lastReportAt = 0;
      this.generatingSince = null;
      this.observer = null;
      this.pollHandle = null;
    }

    init() {
      this.tick("init");
      this.observer = new MutationObserver(() => this.tick("mutation"));
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      this.pollHandle = window.setInterval(() => this.tick("poll"), POLL_INTERVAL_MS);
    }

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.pollHandle !== null) {
        clearInterval(this.pollHandle);
      }
    }

    getCurrentState() {
      return this.currentState;
    }

    getGeneratingDuration(now = Date.now()) {
      return this.generatingSince === null ? 0 : now - this.generatingSince;
    }

    debug(message) {
      this.reporter({ type: "DEBUG_LOG", payload: `[${this.platform}] ${message}` });
    }

    tick(origin) {
      const snapshot = this.evaluate();
      const now = Date.now();
      const nextState =
        snapshot.state === "FINISHED" && this.generatingSince !== null && now - this.generatingSince < MIN_GENERATION_MS
          ? "GENERATING"
          : snapshot.state;

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
        if (nextState !== "GENERATING") {
          this.generatingSince = nextState === "FINISHED" ? null : null;
        }
        this.sendState(nextState, snapshot);
        return;
      }

      if (this.currentState === "GENERATING" && now - this.lastReportAt >= REPORT_HEARTBEAT_MS) {
        this.sendState(this.currentState, snapshot);
      }
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

  class ClaudeDetector extends DetectorBase {
    constructor(reporter) {
      super("claude", reporter);
      this.textTracker = new TextStabilityTracker();
      this.lastStrongGeneratingSignalAt = 0;
      this.lastUserActivityAt = 0;
      this.hasSeededAssistantSnapshot = false;
      this.clickHandler = (event) => {
        const button = event.target && event.target.closest ? event.target.closest("button") : null;
        if (!button) return;
        const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
          .filter(Boolean)
          .join(" ");
        if (hasKeyword(text, ["send", "send message", "发送"])) {
          this.lastUserActivityAt = Date.now();
        }
      };
      this.keydownHandler = (event) => {
        const target = event.target;
        if (target && this.isPromptSurface(target) && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
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
      const userMessages = queryAll(USER_MESSAGE_SELECTORS);
      const assistantMessages = this.getAssistantMessages();

      const lastAssistant = assistantMessages.at(-1) || null;
      const textSnapshot = this.textTracker.update(normalizeText(lastAssistant ? lastAssistant.textContent : ""), now);
      const assistantChanging =
        this.hasSeededAssistantSnapshot &&
        (textSnapshot.changed || this.textTracker.changedWithin(RECENT_STREAM_ACTIVITY_MS, now));
      this.hasSeededAssistantSnapshot = true;

      const hasStopButton = Boolean(findButtonByKeywords(STOP_BUTTON_KEYWORDS));
      const hasCompletionUi = Boolean(findButtonByKeywords(COMPLETION_BUTTON_KEYWORDS));
      const inputReady = isEditable(queryOne(INPUT_SELECTORS));
      const hasBusyRegion = Boolean(queryOne(BUSY_SELECTORS));
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

      let state = "UNKNOWN";
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

      return { state, reason, meta: { textHash: textSnapshot.hash, textLength: textSnapshot.length } };
    }

    isPromptSurface(target) {
      return INPUT_SELECTORS.some((selector) => target.matches(selector) || (target.closest && target.closest(selector)));
    }

    getAssistantMessages() {
      const directMatches = queryAll(ASSISTANT_MESSAGE_SELECTORS);
      if (directMatches.length > 0) {
        return directMatches;
      }

      const prompt = queryOne(INPUT_SELECTORS);
      return findTextHeavyElements(FALLBACK_MESSAGE_SELECTORS).filter((element) => !prompt || !element.contains(prompt));
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

  const detector = new ClaudeDetector(sendMessage);
  detector.init();
  window.__aiWaitModeClaudeDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeClaudeDetector;
  });
})();
