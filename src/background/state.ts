import { createEmptySession, getSessionState, setSessionState } from "../common/storage";
import type {
  AIPageState,
  ContentToBackgroundMessage,
  PlatformId,
  SessionState
} from "../common/messaging";

type TrackedTabState = {
  platform: PlatformId;
  state: AIPageState;
  timestamp: number;
  meta?: Extract<ContentToBackgroundMessage, { type: "AI_STATE_CHANGED" }>["meta"];
};

class RuntimeStateStore {
  private hydrated = false;
  private session: SessionState = createEmptySession();
  private trackedTabStates = new Map<number, TrackedTabState>();

  async hydrate(): Promise<void> {
    if (this.hydrated) {
      return;
    }

    this.session = await getSessionState();
    this.hydrated = true;
  }

  getSession(): SessionState {
    return this.session;
  }

  async replaceSession(session: SessionState): Promise<void> {
    this.session = {
      ...createEmptySession(),
      ...session
    };
    await setSessionState(this.session);
  }

  async patchSession(patch: Partial<SessionState>): Promise<void> {
    await this.replaceSession({
      ...this.session,
      ...patch
    });
  }

  noteTrackedState(tabId: number, state: TrackedTabState): void {
    this.trackedTabStates.set(tabId, state);
  }

  getTrackedState(tabId: number | null): TrackedTabState | null {
    if (tabId === null) {
      return null;
    }

    return this.trackedTabStates.get(tabId) ?? null;
  }

  removeTab(tabId: number): void {
    this.trackedTabStates.delete(tabId);
  }
}

export const runtimeStateStore = new RuntimeStateStore();
