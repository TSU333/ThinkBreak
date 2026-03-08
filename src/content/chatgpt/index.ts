import type { ContentToBackgroundMessage } from "../../common/messaging";
import { ChatGptDetector } from "./detector";

declare global {
  interface Window {
    __aiWaitModeChatGptDetector?: ChatGptDetector;
  }
}

const sendMessage = (message: ContentToBackgroundMessage): void => {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === "function") {
      void result.catch(() => {
        // Ignore transient worker wake-up errors; the next mutation or heartbeat will retry.
      });
    }
  } catch {
    // Ignore transient worker wake-up errors; the next mutation or heartbeat will retry.
  }
};

if (!window.__aiWaitModeChatGptDetector) {
  const detector = new ChatGptDetector(sendMessage);
  detector.init();
  window.__aiWaitModeChatGptDetector = detector;

  window.addEventListener("beforeunload", () => {
    detector.destroy();
    delete window.__aiWaitModeChatGptDetector;
  });
}
