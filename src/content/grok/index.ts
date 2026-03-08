import type { ContentToBackgroundMessage } from "../../common/messaging";
import { GrokDetector } from "./detector";

declare global {
  interface Window {
    __aiWaitModeGrokDetector?: GrokDetector;
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

if (!window.__aiWaitModeGrokDetector) {
  const detector = new GrokDetector(sendMessage);
  detector.init();
  window.__aiWaitModeGrokDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeGrokDetector;
  });
}
