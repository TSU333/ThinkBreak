import type { ContentToBackgroundMessage } from "../../common/messaging";
import { ClaudeDetector } from "./detector";

declare global {
  interface Window {
    __aiWaitModeClaudeDetector?: ClaudeDetector;
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

if (!window.__aiWaitModeClaudeDetector) {
  const detector = new ClaudeDetector(sendMessage);
  detector.init();
  window.__aiWaitModeClaudeDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeClaudeDetector;
  });
}
