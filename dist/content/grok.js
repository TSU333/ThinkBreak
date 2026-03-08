(() => {
  if (window.__aiWaitModeGrokDetector) {
    return;
  }

  const STOP_BUTTON_KEYWORDS = ["stop generating", "stop response", "停止生成", "停止响应"];
  const COMPLETION_BUTTON_KEYWORDS = [
    "copy",
    "retry",
    "regenerate",
    "share",
    "copy response",
    "good response",
    "bad response",
    "复制",
    "重试"
  ];
  const INPUT_SELECTORS = [
    "textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][aria-label]",
    "div[contenteditable='true'][data-placeholder]",
    "div[contenteditable='true'][data-testid='tweetTextarea_0']",
    "div[contenteditable='true'][data-testid='dmComposerTextInput']",
    "div[contenteditable='true'][dir='auto']"
  ];
  const USER_MESSAGE_SELECTORS = [
    "[data-testid*='user-message']",
    "[data-testid*='conversation-turn-user']",
    "[data-role='user']",
    "[data-author='user']"
  ];
  const ASSISTANT_MESSAGE_SELECTORS = [
    "[data-testid*='assistant-message']",
    "[data-testid*='conversation-turn-assistant']",
    "[data-role='assistant']",
    "[data-author='assistant']"
  ];
  const BUSY_SELECTORS = [
    "[aria-busy='true']",
    "[role='progressbar']",
    "[aria-label*='thinking' i]",
    "[aria-label*='generating' i]",
    "[aria-label*='responding' i]",
    "[data-testid='typingIndicator']",
    "[data-testid='progressBar']"
  ];
  const FALLBACK_MESSAGE_SELECTORS = [
    "main article",
    "[role='main'] article",
    "main [role='article']",
    "main [role='listitem']",
    "main section",
    "[role='main'] section",
    "main div[data-testid]",
    "main div[dir='auto']",
    "[data-testid='primaryColumn'] article",
    "[data-testid='primaryColumn'] div[dir='auto']"
  ];
  const POLL_INTERVAL_MS = 500;
  const REPORT_HEARTBEAT_MS = 1000;
  const STATE_DEBOUNCE_MS = 500;
  const MIN_GENERATION_MS = 1000;
  const POST_GENERATING_COOLDOWN_MS = 5000;
  const TEXT_SILENCE_MS = 2500;
  const RECENT_USER_ACTIVITY_MS = 6000;
  const RECENT_STREAM_ACTIVITY_MS = 1800;
  const GENERATING_STICKY_MS = 5000;
  const FINISH_GRACE_WINDOW_MS = 30000;
  const NETWORK_ACTIVITY_MS = 2500;
  const NETWORK_PROBE_KEYWORDS = ["grok", "conversation", "chat", "completion", "graphql", "response", "stream"];
  const PAGE_PROBE_SOURCE = "AI_WAIT_MODE_PAGE";

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
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const button of buttons) {
      if (!(button instanceof HTMLElement)) {
        continue;
      }

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
        if (!isVisible(element)) {
          return false;
        }

        if (element.closest("form, nav, header, footer, aside, button, [role='button']")) {
          return false;
        }

        return normalizeText(element.textContent).length >= minLength;
      })
      .filter((element, index, elements) => {
        return !elements.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(element));
      });
  }

  function installNetworkProbe(platform, keywords, options) {
    const marker = `data-ai-wait-mode-probe-${platform}`;
    if (document.documentElement.hasAttribute(marker)) {
      return;
    }

    document.documentElement.setAttribute(marker, "1");
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("dist/content/page-probe.js");
    script.dataset.platform = platform;
    script.dataset.keywords = JSON.stringify(keywords);
    script.dataset.trackSameOrigin = options && options.trackSameOrigin ? "true" : "false";
    script.dataset.marker = marker;
    script.addEventListener("load", () => {
      script.remove();
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
    }, { once: true });
    (document.head || document.documentElement).appendChild(script);
  }

  function isPageProbeEvent(event, platform) {
    const data = event.data;
    return Boolean(
      event.source === window &&
        data &&
        data.source === PAGE_PROBE_SOURCE &&
        data.platform === platform &&
        (data.kind === "REQUEST_START" || data.kind === "REQUEST_END")
    );
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
      this.postGeneratingStateUntil = 0;
      this.observer = null;
      this.pollHandle = null;
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

    getGeneratingDuration(now = Date.now()) {
      return this.generatingSince === null ? 0 : now - this.generatingSince;
    }

    debug(message) {
      this.reporter({
        type: "DEBUG_LOG",
        payload: `[${this.platform}] ${message}`
      });
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
        const previousState = this.currentState;
        this.currentState = nextState;

        if (nextState === "GENERATING" && this.generatingSince === null) {
          this.generatingSince = now;
        }

        if (nextState !== "GENERATING") {
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

  class GrokDetector extends DetectorBase {
    constructor(reporter) {
      super("grok", reporter);
      this.textTracker = new TextStabilityTracker();
      this.transcriptTracker = new TextStabilityTracker();
      this.lastStrongGeneratingSignalAt = 0;
      this.lastUserActivityAt = 0;
      this.activeProbeRequests = 0;
      this.lastProbeActivityAt = 0;
      this.hasSeededAssistantSnapshot = false;
      this.hasSeededTranscriptSnapshot = false;

      this.clickHandler = (event) => {
        const button = event.target && event.target.closest ? event.target.closest("button, [role='button']") : null;
        if (!button) {
          return;
        }

        const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
          .filter(Boolean)
          .join(" ");

        if (hasKeyword(text, ["send", "post", "ask grok", "发送"])) {
          this.lastUserActivityAt = Date.now();
        }
      };

      this.submitHandler = () => {
        this.lastUserActivityAt = Date.now();
      };

      this.messageHandler = (event) => {
        if (!isPageProbeEvent(event, "grok")) {
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

      this.keydownHandler = (event) => {
        const target = event.target;
        if (target && this.isPromptSurface(target) && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          this.lastUserActivityAt = Date.now();
        }
      };
    }

    init() {
      installNetworkProbe("grok", NETWORK_PROBE_KEYWORDS, { trackSameOrigin: false });
      document.addEventListener("click", this.clickHandler, true);
      document.addEventListener("keydown", this.keydownHandler, true);
      document.addEventListener("submit", this.submitHandler, true);
      window.addEventListener("message", this.messageHandler);
      super.init();
    }

    destroy() {
      document.removeEventListener("click", this.clickHandler, true);
      document.removeEventListener("keydown", this.keydownHandler, true);
      document.removeEventListener("submit", this.submitHandler, true);
      window.removeEventListener("message", this.messageHandler);
      super.destroy();
    }

    evaluate() {
      const now = Date.now();
      const userMessages = queryAll(USER_MESSAGE_SELECTORS);
      const assistantMessages = this.getAssistantMessages();

      const lastAssistant = assistantMessages.at(-1) || null;
      const lastAssistantText = normalizeText(lastAssistant ? lastAssistant.textContent : "");
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
      const inputReady = isEditable(queryOne(INPUT_SELECTORS));
      const hasBusyRegion = Boolean(queryOne(BUSY_SELECTORS));
      const recentUserActivity = now - this.lastUserActivityAt <= RECENT_USER_ACTIVITY_MS;
      const hasNetworkActivity =
        this.activeProbeRequests > 0 ||
        (this.lastProbeActivityAt > 0 && now - this.lastProbeActivityAt <= NETWORK_ACTIVITY_MS);
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

      let state = "UNKNOWN";
      let reason = "grok detector is waiting for stronger evidence";

      if (completionLikely) {
        state = "FINISHED";
        reason = "Grok response text stayed stable and composer is ready";
      } else if (hasStopButton || busyGenerating || streamingLikely || networkGenerating || stickyGenerating) {
        state = "GENERATING";
        reason =
          `Grok generation signals stop=${String(hasStopButton)} busy=${String(busyGenerating)} ` +
          `stream=${String(streamChanging)} network=${String(networkGenerating)} sticky=${String(stickyGenerating)}`;
      } else if (!hasConversation) {
        state = "IDLE";
        reason = "no Grok conversation nodes were found";
      } else if (!hasStopButton && !streamChanging && !recentUserActivity) {
        state = "IDLE";
        reason = "Grok conversation is stable with no active generation signal";
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

    isPromptSurface(target) {
      return INPUT_SELECTORS.some((selector) => target.matches(selector) || (target.closest && target.closest(selector)));
    }

    getAssistantMessages() {
      const directMatches = queryAll(ASSISTANT_MESSAGE_SELECTORS);
      if (directMatches.length > 0) {
        return directMatches;
      }

      const prompt = queryOne(INPUT_SELECTORS);
      const conversationRoot =
        (prompt && prompt.closest("[data-testid='primaryColumn'], main, [role='main'], section, article")) || null;
      const candidates = findTextHeavyElements(FALLBACK_MESSAGE_SELECTORS, 24).filter((element) => {
        if (prompt && element.contains(prompt)) {
          return false;
        }

        if (conversationRoot && !conversationRoot.contains(element)) {
          return false;
        }

        if (prompt) {
          const position = element.compareDocumentPosition(prompt);
          if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
            return false;
          }
        }

        return true;
      });

      return candidates.slice(-8);
    }
  }

  const sendMessage = (message) => {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {}
  };

  const detector = new GrokDetector(sendMessage);
  detector.init();
  window.__aiWaitModeGrokDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeGrokDetector;
  });
})();
