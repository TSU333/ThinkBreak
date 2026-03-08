import { createEmptySession, getSessionState, setSessionState } from "../common/storage.js";

class RuntimeStateStore {
  constructor() {
    this.hydrated = false;
    this.session = createEmptySession();
    this.trackedTabStates = new Map();
  }

  async hydrate() {
    if (this.hydrated) {
      return;
    }

    this.session = await getSessionState();
    this.hydrated = true;
  }

  getSession() {
    return this.session;
  }

  async replaceSession(session) {
    this.session = {
      ...createEmptySession(),
      ...session
    };
    await setSessionState(this.session);
  }

  async patchSession(patch) {
    await this.replaceSession({
      ...this.session,
      ...patch
    });
  }

  noteTrackedState(tabId, state) {
    this.trackedTabStates.set(tabId, state);
  }

  getTrackedState(tabId) {
    if (tabId === null) {
      return null;
    }

    return this.trackedTabStates.get(tabId) || null;
  }

  removeTab(tabId) {
    this.trackedTabStates.delete(tabId);
  }
}

export const runtimeStateStore = new RuntimeStateStore();
