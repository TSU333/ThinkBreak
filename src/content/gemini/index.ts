import type { ContentToBackgroundMessage } from "../../common/messaging";
import { GeminiDetector } from "./detector";

declare global {
  interface Window {
    __aiWaitModeGeminiDetector?: GeminiDetector;
  }
}

const sendMessage = (message: ContentToBackgroundMessage): void => {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === "function") {
      void result.catch(() => {});
    }
  } catch {
    // Ignore transient worker wake-up failures.
  }
};

if (!window.__aiWaitModeGeminiDetector) {
  const detector = new GeminiDetector(sendMessage);
  detector.init();
  window.__aiWaitModeGeminiDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeGeminiDetector;
  });
}
