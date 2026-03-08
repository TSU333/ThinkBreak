import {
  RUNTIME_GUARDS,
  detectPlatformFromUrl,
  resolveRedirectUrl
} from "../common/constants";
import {
  createEmptySession,
  ensureDefaultSettings,
  getUserSettings
} from "../common/storage";
import type {
  AIPageState,
  BackgroundToPopupResponse,
  ContentToBackgroundMessage,
  PopupToBackgroundMessage,
  SessionState,
  UserSettings
} from "../common/messaging";
import { runtimeStateStore } from "./state";
import {
  focusAiTab,
  isAiTabInForeground,
  openOrReuseShortVideoTab
} from "./tabManager";

let bootstrapPromise: Promise<void> | null = null;
const WORKER_STARTED_AT = Date.now();

function buildTrackedState(message: Extract<ContentToBackgroundMessage, { type: "AI_STATE_CHANGED" }>) {
  return {
    platform: message.platform,
    state: message.state,
    timestamp: message.timestamp,
    meta: message.meta
  };
}

function isTrackedSession(session: SessionState): boolean {
  return Boolean(session.aiTabId !== null && session.startedAt !== null && session.platform !== null);
}

function getGeneratingStaleness(session: SessionState, now: number): number {
  if (session.lastGeneratingHeartbeatAt === null) {
    return Number.POSITIVE_INFINITY;
  }

  return now - session.lastGeneratingHeartbeatAt;
}

function hasFreshHeartbeatForCurrentWorker(session: SessionState): boolean {
  return session.lastGeneratingHeartbeatAt !== null && session.lastGeneratingHeartbeatAt >= WORKER_STARTED_AT;
}

async function logDebug(message: string): Promise<void> {
  const settings = await getUserSettings();
  if (settings.debug) {
    console.log(`[ThinkBreak] ${message}`);
  }
}

async function resetSession(
  reason: string,
  _options: {
    skipNotificationClear?: boolean;
  } = {}
): Promise<void> {
  await runtimeStateStore.replaceSession(createEmptySession());
  await logDebug(`session reset: ${reason}`);
}

async function bootstrapRuntime(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await ensureDefaultSettings();
      await runtimeStateStore.hydrate();
      await reconcileStoredSession("bootstrap");
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  await bootstrapPromise;
}

async function reconcileStoredSession(trigger: string): Promise<void> {
  const settings = await getUserSettings();
  const session = runtimeStateStore.getSession();

  if (!settings.enabled) {
    if (isTrackedSession(session) || session.finishedAt !== null) {
      await resetSession(`${trigger}: extension disabled`);
    }
    return;
  }

  if (session.finishedAt !== null) {
    await resetSession(`${trigger}: cleared a stale completion session`);
    return;
  }

  await maybeRedirectToBreakSite(`${trigger}: reconcile`);
}

function canAttemptRedirect(session: SessionState, settings: UserSettings, now = Date.now()): boolean {
  if (!settings.enabled || !isTrackedSession(session) || session.hasRedirected || session.finishedAt !== null) {
    return false;
  }

  if (session.lastKnownState !== "GENERATING") {
    return false;
  }

  if (session.redirectDueAt === null || now < session.redirectDueAt) {
    return false;
  }

  if (!hasFreshHeartbeatForCurrentWorker(session)) {
    return false;
  }

  return getGeneratingStaleness(session, now) <= RUNTIME_GUARDS.generatingHeartbeatStaleMs;
}

async function maybeRedirectToBreakSite(trigger: string): Promise<void> {
  const settings = await getUserSettings();
  const session = runtimeStateStore.getSession();
  const targetUrl = resolveRedirectUrl(settings);

  if (!targetUrl) {
    await logDebug(`${trigger}: redirect skipped because target URL is invalid`);
    return;
  }

  if (!canAttemptRedirect(session, settings)) {
    return;
  }

  const shortTab = await openOrReuseShortVideoTab(session, settings, targetUrl);
  await runtimeStateStore.patchSession({
    shortTabId: shortTab.tabId,
    shortWindowId: shortTab.windowId,
    hasRedirected: true
  });

  await logDebug(`${trigger}: redirected to ${targetUrl}`);
}

async function handleCompletion(trigger: string, timestamp: number): Promise<void> {
  const session = runtimeStateStore.getSession();

  if (!isTrackedSession(session)) {
    return;
  }

  if (!session.hasRedirected) {
    await resetSession(`${trigger}: completed before redirect`);
    return;
  }

  if (await isAiTabInForeground(session)) {
    await resetSession(`${trigger}: user already returned to the AI tab`);
    return;
  }

  const focused = await focusAiTab(session);
  if (focused) {
    await resetSession(`${trigger}: auto switched back to AI tab`);
    return;
  }

  await resetSession(`${trigger}: reply finished but the original AI tab no longer exists`);
}

async function getPopupState(message?: string): Promise<BackgroundToPopupResponse> {
  await bootstrapRuntime();

  const session = runtimeStateStore.getSession();
  const trackedState = runtimeStateStore.getTrackedState(session.aiTabId);
  const settings = await getUserSettings();
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const fallbackPlatform = detectPlatformFromUrl(activeTab?.url);

  return {
    ok: true,
    session,
    trackedState: trackedState?.state ?? session.lastKnownState ?? null,
    trackedPlatform: trackedState?.platform ?? session.platform ?? fallbackPlatform,
    targetUrl: resolveRedirectUrl(settings),
    message
  };
}

async function handleGeneratingMessage(
  message: Extract<ContentToBackgroundMessage, { type: "AI_STATE_CHANGED" }>,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const settings = await getUserSettings();
  if (!settings.enabled) {
    return;
  }

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId ?? null;
  const isActiveTab = Boolean(sender.tab?.active);

  if (typeof tabId !== "number") {
    return;
  }

  runtimeStateStore.noteTrackedState(tabId, buildTrackedState(message));

  const currentSession = runtimeStateStore.getSession();
  const staleRedirectedSession =
    currentSession.aiTabId === tabId &&
    currentSession.hasRedirected &&
    currentSession.finishedAt === null &&
    isActiveTab;
  const shouldTrackThisTab =
    currentSession.aiTabId === tabId ||
    currentSession.aiTabId === null ||
    isActiveTab;

  if (!shouldTrackThisTab) {
    await logDebug(`ignored GENERATING from tab ${tabId} because another active session is being tracked`);
    return;
  }

  const isSameTab = currentSession.aiTabId === tabId && currentSession.finishedAt === null && !staleRedirectedSession;
  const startedAt = isSameTab && currentSession.startedAt !== null ? currentSession.startedAt : message.timestamp;

  const nextSession: SessionState = {
    platform: message.platform,
    aiTabId: tabId,
    aiWindowId: windowId,
    shortTabId: isSameTab ? currentSession.shortTabId : null,
    shortWindowId: isSameTab ? currentSession.shortWindowId : null,
    hasRedirected: isSameTab ? currentSession.hasRedirected : false,
    startedAt,
    finishedAt: null,
    lastKnownState: "GENERATING",
    lastStateAt: message.timestamp,
    lastGeneratingHeartbeatAt: message.timestamp,
    redirectDueAt: startedAt + settings.thresholdSeconds * 1000
  };

  await runtimeStateStore.replaceSession(nextSession);
  await maybeRedirectToBreakSite("generating-heartbeat");
}

async function handleFinishedMessage(
  message: Extract<ContentToBackgroundMessage, { type: "AI_STATE_CHANGED" }>,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }

  runtimeStateStore.noteTrackedState(tabId, buildTrackedState(message));

  const session = runtimeStateStore.getSession();
  if (session.aiTabId !== tabId) {
    return;
  }

  await runtimeStateStore.patchSession({
    finishedAt: message.timestamp,
    lastKnownState: "FINISHED",
    lastStateAt: message.timestamp
  });

  await handleCompletion("detector-finished", message.timestamp);
}

async function handleCoolingState(
  message: Extract<ContentToBackgroundMessage, { type: "AI_STATE_CHANGED" }>,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }

  runtimeStateStore.noteTrackedState(tabId, buildTrackedState(message));

  const currentSession = runtimeStateStore.getSession();
  if (currentSession.aiTabId !== tabId) {
    return;
  }

  await runtimeStateStore.patchSession({
    lastKnownState: message.state,
    lastStateAt: message.timestamp
  });

  const updatedSession = runtimeStateStore.getSession();
  if (updatedSession.finishedAt !== null) {
    return;
  }

  const staleMs = getGeneratingStaleness(updatedSession, message.timestamp);
  if (
    updatedSession.hasRedirected &&
    (message.state === "IDLE" || message.state === "UNKNOWN") &&
    staleMs >= RUNTIME_GUARDS.redirectedIdleFallbackMs
  ) {
    await logDebug(`post-generation fallback fired after redirect because FINISHED was not observed (${message.state})`);
    await handleCompletion("idle-fallback", message.timestamp);
    return;
  }

  if (
    !updatedSession.hasRedirected &&
    (message.state === "IDLE" || message.state === "UNKNOWN") &&
    staleMs >= RUNTIME_GUARDS.preRedirectCooldownMs
  ) {
    await resetSession(`cooldown reached while detector reported ${message.state}`);
  }
}

async function handleContentMessage(
  message: ContentToBackgroundMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  await bootstrapRuntime();

  if (message.type === "DEBUG_LOG") {
    await logDebug(message.payload);
    return;
  }

  if (message.state === "GENERATING") {
    await handleGeneratingMessage(message, sender);
    return;
  }

  if (message.state === "FINISHED") {
    await handleFinishedMessage(message, sender);
    return;
  }

  await handleCoolingState(message, sender);
}

async function handlePopupMessage(message: PopupToBackgroundMessage): Promise<BackgroundToPopupResponse> {
  await bootstrapRuntime();

  if (message.type === "SETTINGS_UPDATED") {
    if (!message.settings.enabled) {
      await resetSession("disabled from popup");
      return getPopupState();
    }

    const session = runtimeStateStore.getSession();
    if (isTrackedSession(session) && !session.hasRedirected && session.startedAt !== null && session.finishedAt === null) {
      await runtimeStateStore.patchSession({
        redirectDueAt: session.startedAt + message.settings.thresholdSeconds * 1000
      });
      await maybeRedirectToBreakSite("settings-updated");
    }
  }

  return getPopupState();
}

chrome.runtime.onInstalled.addListener(() => {
  void bootstrapRuntime();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrapRuntime();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes["aiWaitMode:userSettings"]) {
    return;
  }

  void bootstrapRuntime().then(async () => {
    const settings = await getUserSettings();
    if (!settings.enabled) {
      await resetSession("settings disabled the extension");
      return;
    }

    const session = runtimeStateStore.getSession();
    if (isTrackedSession(session) && !session.hasRedirected && session.startedAt !== null && session.finishedAt === null) {
      await runtimeStateStore.patchSession({
        redirectDueAt: session.startedAt + settings.thresholdSeconds * 1000
      });
      await maybeRedirectToBreakSite("storage-change");
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void bootstrapRuntime().then(async () => {
    runtimeStateStore.removeTab(tabId);

    const session = runtimeStateStore.getSession();
    if (session.shortTabId === tabId) {
      await runtimeStateStore.patchSession({
        shortTabId: null,
        shortWindowId: null
      });
      await logDebug("short target tab was closed manually; keeping the AI session alive");
      return;
    }

    if (session.aiTabId === tabId) {
      await resetSession("tracked AI tab was closed");
    }
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void bootstrapRuntime().then(async () => {
    const session = runtimeStateStore.getSession();
    if (session.aiTabId === activeInfo.tabId && session.hasRedirected) {
      await resetSession("user manually returned to the AI tab");
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void bootstrapRuntime().then(async () => {
    const session = runtimeStateStore.getSession();
    if (session.aiTabId !== tabId) {
      return;
    }

    const currentUrl = changeInfo.url ?? tab.url;
    if (!detectPlatformFromUrl(currentUrl)) {
      await resetSession("tracked AI tab navigated away from a supported AI site");
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const isPopupMessage =
    message?.type === "GET_RUNTIME_STATE" ||
    message?.type === "SETTINGS_UPDATED";

  const task = isPopupMessage
    ? handlePopupMessage(message as PopupToBackgroundMessage)
    : handleContentMessage(message as ContentToBackgroundMessage, sender).then(() => ({
        ok: true,
        session: runtimeStateStore.getSession(),
        trackedState: runtimeStateStore.getSession().lastKnownState,
        trackedPlatform: runtimeStateStore.getSession().platform,
        targetUrl: null
      }));

  void task
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      console.error("[ThinkBreak] background error", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error"
      });
    });

  return true;
});
