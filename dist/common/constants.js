export const EXTENSION_NAME = "ThinkBreak";

export const STORAGE_KEYS = {
  settings: "aiWaitMode:userSettings",
  session: "aiWaitMode:sessionState"
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  thresholdSeconds: 8,
  shortSite: "tiktok",
  customShortUrl: "",
  debug: false
};

export const THRESHOLD_LIMITS = {
  min: 3,
  max: 120
};

export const SHORT_SITE_URLS = {
  tiktok: "https://www.tiktok.com/foryou",
  "youtube-shorts": "https://www.youtube.com/shorts",
  douyin: "https://www.douyin.com/",
  xiaohongshu: "https://www.xiaohongshu.com/explore"
};

export const SHORT_SITE_LABELS = {
  tiktok: "TikTok",
  "youtube-shorts": "YouTube Shorts",
  douyin: "Douyin",
  xiaohongshu: "Xiaohongshu",
  custom: "Custom website"
};

const SHORT_SITE_HOST_SUFFIXES = {
  tiktok: ["tiktok.com"],
  "youtube-shorts": ["youtube.com", "youtu.be"],
  douyin: ["douyin.com"],
  xiaohongshu: ["xiaohongshu.com", "xiaohongshu.cn", "xhslink.com"]
};

export const PLATFORM_LABELS = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  codex: "Codex"
};

export const STATE_LABELS = {
  UNKNOWN: "Unknown",
  IDLE: "Idle",
  GENERATING: "Generating",
  FINISHED: "Finished"
};

export const RUNTIME_GUARDS = {
  generatingHeartbeatStaleMs: 6500,
  preRedirectCooldownMs: 5000,
  redirectedIdleFallbackMs: 3500,
  badgeText: "AI"
};

export function normalizeUrlInput(value) {
  return (value || "").trim();
}

export function isValidCustomUrl(value) {
  const normalized = normalizeUrlInput(value);
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveRedirectUrl(settings) {
  if (settings.shortSite === "custom") {
    return isValidCustomUrl(settings.customShortUrl) ? normalizeUrlInput(settings.customShortUrl) : null;
  }

  return SHORT_SITE_URLS[settings.shortSite];
}

export function isRedirectTargetUrl(settings, candidateUrl) {
  if (!candidateUrl) {
    return false;
  }

  try {
    const candidate = new URL(candidateUrl);

    if (settings.shortSite === "custom") {
      if (!isValidCustomUrl(settings.customShortUrl)) {
        return false;
      }

      const target = new URL(normalizeUrlInput(settings.customShortUrl));
      return candidate.hostname === target.hostname;
    }

    return SHORT_SITE_HOST_SUFFIXES[settings.shortSite].some(
      (hostSuffix) => candidate.hostname === hostSuffix || candidate.hostname.endsWith(`.${hostSuffix}`)
    );
  } catch {
    return false;
  }
}

export function detectPlatformFromUrl(url) {
  if (!url) {
    return null;
  }

  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) {
    return "chatgpt";
  }

  if (url.includes("claude.ai")) {
    return "claude";
  }

  if (url.includes("gemini.google.com")) {
    return "gemini";
  }

  if (url.includes("grok.com") || url.includes("x.com/i/grok")) {
    return "grok";
  }

  return null;
}
