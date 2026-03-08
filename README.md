# ThinkBreak
ThinkBreak

Stop staring at the screen while waiting for AI.

ThinkBreak is a Chrome / Edge browser extension.
When an AI (ChatGPT / Claude / Gemini / Grok) is generating a response and the waiting time exceeds a configured threshold, the extension automatically opens a “break website”. When the AI finishes responding, ThinkBreak automatically switches back to the original AI tab.

Instead of staring at the loading screen, you can take a short break while the AI is working.

If you find ThinkBreak useful, please give the project a Star ⭐.

Features
Automatically detects whether AI is generating a response
Supports multiple AI platforms
Automatically opens a break website when AI responses take longer
Automatically returns to the AI page when the response is finished
Supports custom waiting thresholds
Supports multiple break websites
Compatible with Chrome / Edge browsers (Manifest V3)

Supported Platforms

AI Websites
ChatGPT Web
Claude Web
Gemini Web
Grok Web

Break Websites
TikTok Web
YouTube Shorts
Douyin Web
Xiaohongshu Web
User-defined websites

Installation

Load the extension in developer mode

This repository already includes the compiled dist directory, which can be loaded directly.

Steps:
1.Open Chrome or Edge browser
2.Open the extensions management page
3.Enable Developer Mode
4.Click Load unpacked
5.Select the project directory

The extension will then run locally.

Build from source

If Node.js is installed on your computer, you can rebuild using the following commands:

npm install
npm run build

After building, reload the extension directory.

Extension Settings

ThinkBreak provides the following configuration options:
• Enable / Disable the extension
• Trigger threshold (seconds)
• Break website selection
• Custom website URL
• Debug mode

Supported break websites include:
• TikTok
• YouTube Shorts
• Douyin
• Xiaohongshu
• Custom websites

How It Works

ThinkBreak determines whether an AI is generating a response through DOM structure and UI signals.

The extension does not rely on any official API but instead infers the state by observing page behavior.

Main detection signals include:

• Whether a “Stop generating” button appears on the page
• Whether the page shows a busy state
• Whether the AI response text is continuously changing
• Whether the input box becomes interactive again
• Whether completion UI elements such as Copy / Regenerate appear

Multiple signals are combined to improve detection accuracy.

State Model

Page state:

type AIPageState =
| “UNKNOWN”
| “IDLE”
| “GENERATING”
| “FINISHED”;

Background session state:

type SessionState = {
platform: “chatgpt” | “claude” | “gemini” | “grok” | “codex” | null;
aiTabId: number | null;
aiWindowId: number | null;
shortTabId: number | null;
shortWindowId: number | null;
hasRedirected: boolean;
startedAt: number | null;
finishedAt: number | null;
};

Detection Stability Strategy

To reduce misclassification, ThinkBreak combines multiple signals.

Generating signals
• Stop generating button appears
• The page enters a busy state
• AI response text continues to change
• The user has just sent a message

Completion signals
• Stop button disappears
• AI response text remains stable for 2500ms
• The input box becomes interactive again
• Regenerate or Copy buttons appear

⸻

Architecture

ThinkBreak uses a modular browser extension architecture.

content scripts
│
▼
AI detector modules
│
▼
background service worker
│
▼
tab management and session state

Main modules:

Background / Service Worker

Responsible for:
• Session state management
• Automatic redirect logic
• Tab switching

Content Scripts

Responsible for AI platform state detection:
• ChatGPT detector
• Claude detector
• Gemini detector
• Grok detector

Popup

Responsible for:
• User settings
• State display
• Debug controls

Known Limitations
• ThinkBreak infers AI state through DOM structure rather than official APIs.
• If AI websites change their frontend structure, selectors may need to be updated.
• Currently only supports web versions of AI.
• Desktop AI applications are not supported.

Future Plans

Phase 2
• Improve Claude / Gemini / Grok detection stability
• Add a debug panel in Popup
• Optimize multi-platform scheduling strategy

Phase 3

• Automated testing
• More robust selector fallback mechanisms

License

Apache License 2.0 License
