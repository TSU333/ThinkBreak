(() => {
  const currentScript = document.currentScript;
  const platform = currentScript && currentScript.dataset ? currentScript.dataset.platform : undefined;
  const marker = currentScript && currentScript.dataset ? currentScript.dataset.marker : undefined;
  const trackSameOrigin = currentScript && currentScript.dataset ? currentScript.dataset.trackSameOrigin === "true" : false;
  let keywords = [];

  try {
    keywords = JSON.parse((currentScript && currentScript.dataset ? currentScript.dataset.keywords : "[]") || "[]");
  } catch {
    keywords = [];
  }

  if (!platform || !Array.isArray(keywords) || keywords.length === 0) {
    return;
  }

  const probeKey = `__aiWaitModePageProbe_${platform}`;
  if (window[probeKey]) {
    return;
  }
  window[probeKey] = true;

  const trackedMethods = new Set(["POST", "PUT", "PATCH"]);

  const post = (kind, url, method) => {
    window.postMessage(
      {
        source: "AI_WAIT_MODE_PAGE",
        platform,
        kind,
        url: String(url || ""),
        method: String(method || "GET").toUpperCase(),
        timestamp: Date.now()
      },
      "*"
    );
  };

  const shouldTrack = (url, method) => {
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

    return keywords.some((keyword) => normalizedUrl.includes(String(keyword).toLowerCase()));
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let url = "";
    let method = "GET";

    try {
      const [input, init] = args;
      if (input instanceof Request) {
        url = input.url;
        method = input.method || method;
      } else {
        url = String(input || "");
      }

      if (init && init.method) {
        method = String(init.method);
      }
    } catch {}

    const tracked = shouldTrack(url, method);
    if (tracked) {
      post("REQUEST_START", url, method);
    }

    const result = originalFetch.apply(this, args);
    if (tracked && result && typeof result.then === "function") {
      result.then(
        () => post("REQUEST_END", url, method),
        () => post("REQUEST_END", url, method)
      );
    }

    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, async, username, password) {
    this.__aiWaitModeMethod = String(method || "GET");
    this.__aiWaitModeUrl = String(url || "");
    return originalOpen.call(this, method, url, async, username, password);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = this.__aiWaitModeMethod || "GET";
    const url = this.__aiWaitModeUrl || "";
    const tracked = shouldTrack(url, method);

    if (tracked) {
      post("REQUEST_START", url, method);
      this.addEventListener(
        "loadend",
        () => {
          post("REQUEST_END", url, method);
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
