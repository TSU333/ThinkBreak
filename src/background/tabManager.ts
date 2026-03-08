import { isRedirectTargetUrl } from "../common/constants";
import type { SessionState, UserSettings } from "../common/messaging";

async function getTabSafely(tabId: number | null): Promise<any | null> {
  if (tabId === null) {
    return null;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function getWindowSafely(windowId: number | null): Promise<any | null> {
  if (windowId === null) {
    return null;
  }

  try {
    return await chrome.windows.get(windowId);
  } catch {
    return null;
  }
}

export async function openOrReuseShortVideoTab(
  session: SessionState,
  settings: UserSettings,
  targetUrl: string
): Promise<{ tabId: number; windowId: number | null }> {
  const existingTab = await getTabSafely(session.shortTabId);

  if (existingTab?.id && isRedirectTargetUrl(settings, getTabUrl(existingTab))) {
    await focusTab(existingTab.id, existingTab.windowId ?? null);

    return {
      tabId: existingTab.id,
      windowId: existingTab.windowId ?? null
    };
  }

  const matchedExistingTab = await findMatchingTargetTab(session, settings);
  if (matchedExistingTab?.id) {
    await focusTab(matchedExistingTab.id, matchedExistingTab.windowId ?? null);

    return {
      tabId: matchedExistingTab.id,
      windowId: matchedExistingTab.windowId ?? null
    };
  }

  let createdTab;
  try {
    createdTab = await chrome.tabs.create({
      url: targetUrl,
      active: true,
      windowId: session.aiWindowId ?? undefined
    });
  } catch {
    createdTab = await chrome.tabs.create({
      url: targetUrl,
      active: true
    });
  }

  if (createdTab.id && createdTab.windowId) {
    await focusTab(createdTab.id, createdTab.windowId ?? null);
  }

  return {
    tabId: createdTab.id,
    windowId: createdTab.windowId ?? null
  };
}

export async function focusAiTab(session: SessionState): Promise<boolean> {
  const aiTab = await getTabSafely(session.aiTabId);
  if (!aiTab?.id) {
    return false;
  }

  const aiWindow = await getWindowSafely(session.aiWindowId ?? aiTab.windowId ?? null);
  if (aiWindow?.id) {
    await chrome.windows.update(aiWindow.id, { focused: true });
  }

  await chrome.tabs.update(aiTab.id, { active: true });
  return true;
}

export async function isAiTabInForeground(session: SessionState): Promise<boolean> {
  const aiTab = await getTabSafely(session.aiTabId);
  if (!aiTab?.id) {
    return false;
  }

  const aiWindow = await getWindowSafely(session.aiWindowId ?? aiTab.windowId ?? null);
  return Boolean(aiTab.active && aiWindow?.focused);
}

async function findMatchingTargetTab(session: SessionState, settings: UserSettings): Promise<any | null> {
  const allTabs = await chrome.tabs.query({});
  const candidates = allTabs
    .filter((tab) => tab.id && tab.id !== session.aiTabId && isRedirectTargetUrl(settings, getTabUrl(tab)))
    .sort((left, right) => scoreTab(right, session.aiWindowId) - scoreTab(left, session.aiWindowId));

  return candidates[0] ?? null;
}

async function focusTab(tabId: number, windowId: number | null): Promise<void> {
  if (windowId !== null) {
    await chrome.windows.update(windowId, { focused: true });
  }

  await chrome.tabs.update(tabId, { active: true });
}

function scoreTab(tab: any, preferredWindowId: number | null): number {
  let score = 0;

  if (preferredWindowId !== null && tab.windowId === preferredWindowId) {
    score += 100;
  }

  if (tab.active) {
    score += 20;
  }

  if (typeof tab.lastAccessed === "number") {
    score += Math.floor(tab.lastAccessed / 1000);
  }

  return score;
}

function getTabUrl(tab: any): string | null {
  return tab?.pendingUrl ?? tab?.url ?? null;
}
