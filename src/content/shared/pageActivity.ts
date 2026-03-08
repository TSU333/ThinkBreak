type ProbePlatform = "gemini" | "grok";
type ProbeOptions = {
  trackSameOrigin: boolean;
};

export type PageProbeEvent = {
  source: "AI_WAIT_MODE_PAGE";
  platform: ProbePlatform;
  kind: "REQUEST_START" | "REQUEST_END";
  url: string;
  method: string;
  timestamp: number;
};

const PAGE_PROBE_SOURCE = "AI_WAIT_MODE_PAGE";

export function installNetworkProbe(platform: ProbePlatform, keywords: string[], options: ProbeOptions): void {
  const marker = `data-ai-wait-mode-probe-${platform}`;
  if (document.documentElement.hasAttribute(marker)) {
    return;
  }

  document.documentElement.setAttribute(marker, "1");

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("dist/content/page-probe.js");
  script.dataset.platform = platform;
  script.dataset.keywords = JSON.stringify(keywords);
  script.dataset.trackSameOrigin = options.trackSameOrigin ? "true" : "false";
  script.dataset.marker = marker;
  script.addEventListener("load", () => {
    script.remove();
  }, { once: true });
  script.addEventListener("error", () => {
    script.remove();
  }, { once: true });

  const parent = document.head ?? document.documentElement;
  parent.appendChild(script);
}

export function isPageProbeEvent(event: MessageEvent, platform: ProbePlatform): event is MessageEvent<PageProbeEvent> {
  const data = event.data as PageProbeEvent | undefined;
  return Boolean(
    event.source === window &&
      data &&
      data.source === PAGE_PROBE_SOURCE &&
      data.platform === platform &&
      (data.kind === "REQUEST_START" || data.kind === "REQUEST_END")
  );
}
