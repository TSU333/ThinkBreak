export type PlatformId = "chatgpt" | "claude" | "gemini" | "grok" | "codex";
export type ShortSite = "tiktok" | "youtube-shorts" | "douyin" | "xiaohongshu" | "custom";
export type AIPageState = "UNKNOWN" | "IDLE" | "GENERATING" | "FINISHED";

export type SessionState = {
  platform: PlatformId | null;
  aiTabId: number | null;
  aiWindowId: number | null;
  shortTabId: number | null;
  shortWindowId: number | null;
  hasRedirected: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastKnownState: AIPageState | null;
  lastStateAt: number | null;
  lastGeneratingHeartbeatAt: number | null;
  redirectDueAt: number | null;
};

export type UserSettings = {
  enabled: boolean;
  thresholdSeconds: number;
  shortSite: ShortSite;
  customShortUrl: string;
  debug: boolean;
};

export type ContentToBackgroundMessage =
  | {
      type: "AI_STATE_CHANGED";
      platform: PlatformId;
      state: AIPageState;
      timestamp: number;
      meta?: {
        textHash?: string;
        textLength?: number;
      };
    }
  | {
      type: "DEBUG_LOG";
      payload: string;
    };

export type PopupToBackgroundMessage =
  | {
      type: "GET_RUNTIME_STATE";
    }
  | {
      type: "SETTINGS_UPDATED";
      settings: UserSettings;
    };

export type BackgroundToPopupResponse =
  | {
      ok: true;
      session: SessionState;
      trackedState: AIPageState | null;
      trackedPlatform: PlatformId | null;
      targetUrl: string | null;
      message?: string;
    }
  | {
      ok: false;
      error: string;
    };
