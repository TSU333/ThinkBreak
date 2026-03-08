(() => {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const platform = currentScript?.dataset.platform as "gemini" | "grok" | undefined;
  const marker = currentScript?.dataset.marker;
  const trackSameOrigin = currentScript?.dataset.trackSameOrigin === "true";
  const keywords = (() => {
    try {
      return JSON.parse(currentScript?.dataset.keywords ?? "[]") as string[];
    } catch {
      return [];
    }
  })();

  if (!platform || keywords.length === 0) {
    return;
  }

  const globalWindow = window as Window & Record<string, unknown>;
  const probeKey = `__aiWaitModePageProbe_${platform}`;
  if (globalWindow[probeKey]) {
    return;
  }
  globalWindow[probeKey] = true;

  const trackedMethods = new Set(["POST", "PUT", "PATCH"]);
  const post = (kind: "REQUEST_START" | "REQUEST_END", url: string, method: string): void => {
    window.postMessage(
      {
        source: "AI_WAIT_MODE_PAGE",
        platform,
        kind,
        url,
        method,
        timestamp: Date.now()
      },
      "*"
    );
  };

  const shouldTrack = (url: string, method: string): boolean => {
    const normalizedMethod = String(method || "GET").toUpperCase();
    if (!trackedMethods.has(normalizedMethod)) {
      return false;
    }

    const normalizedUrl = String(url || "").toLowerCase();
    if (trackSameOrigin) {
      try {
        const targetUrl = new URL(url, window.location.href);
        if (targetUrl.origin === window.location.origin) {
          return true;
        }
      } catch {}
    }

    return keywords.some((keyword) => normalizedUrl.includes(keyword.toLowerCase()));
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    let url = "";
    let method = "GET";

    try {
      const [input, init] = args;
      if (input instanceof Request) {
        url = input.url;
        method = input.method || method;
      } else {
        url = String(input ?? "");
      }

      if (init?.method) {
        method = String(init.method);
      }
    } catch {}

    const tracked = shouldTrack(url, method);
    if (tracked) {
      post("REQUEST_START", url, method.toUpperCase());
    }

    const result = originalFetch.apply(this, args);
    if (tracked) {
      void result.then(
        () => post("REQUEST_END", url, method.toUpperCase()),
        () => post("REQUEST_END", url, method.toUpperCase())
      );
    }

    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const request = this as XMLHttpRequest & { __aiWaitModeMethod?: string; __aiWaitModeUrl?: string };
    request.__aiWaitModeMethod = String(method || "GET");
    request.__aiWaitModeUrl = String(url || "");
    return originalOpen.call(this, method, url, async, username, password);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    const request = this as XMLHttpRequest & { __aiWaitModeMethod?: string; __aiWaitModeUrl?: string };
    const method = request.__aiWaitModeMethod ?? "GET";
    const url = request.__aiWaitModeUrl ?? "";
    const tracked = shouldTrack(url, method);

    if (tracked) {
      post("REQUEST_START", url, method.toUpperCase());
      this.addEventListener(
        "loadend",
        () => {
          post("REQUEST_END", url, method.toUpperCase());
        },
        { once: true }
      );
    }

    return originalSend.call(this, body);
  };

  if (marker) {
    document.documentElement.setAttribute(marker, "ready");
  }
})();
