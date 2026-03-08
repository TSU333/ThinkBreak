ThinkBreak

别再盯着屏幕等 AI 了。

ThinkBreak 是一个 Chrome / Edge 浏览器插件。
当 AI（ChatGPT / Claude / Gemini / Grok）正在生成回复且等待时间超过设定阈值时，插件会自动打开一个“休息网站”；当 AI 回复完成后，ThinkBreak 会自动切回原来的 AI 标签页。

与其盯着加载界面等待，不如在 AI 工作时稍微休息一下。

如果你觉得 ThinkBreak 有用，欢迎给项目 点个 Star ⭐。



功能
自动检测 AI 是否正在生成回复
支持多个 AI 平台
AI 回复时间较长时自动打开休息网站
AI 回复完成后自动返回原 AI 页面
支持自定义等待时间阈值
支持多个休息网站
兼容 Chrome / Edge 浏览器（Manifest V3）



支持的平台

AI 网站
ChatGPT Web
Claude Web
Gemini Web
Grok Web

休息网站
TikTok Web
YouTube Shorts
Douyin Web
Xiaohongshu Web
用户自定义网站


安装方法

开发者模式加载插件

本仓库已经包含编译好的 dist 目录，可以直接加载。

步骤：
1.打开 Chrome 或 Edge 浏览器
2.打开扩展程序管理页面
3.开启 开发者模式
4.点击 加载已解压的扩展程序
5.选择项目目录 ai-wait-mode/

插件即可本地运行。

从源码构建

如果你的电脑已经安装 Node.js，可以使用以下命令重新构建：

npm install
npm run build

构建完成后，重新加载扩展目录即可。



插件设置

ThinkBreak 提供以下配置选项：
•启用 / 禁用插件
•触发阈值（秒）
•休息网站选择
•自定义网站 URL
•调试模式

支持的休息网站包括：
•TikTok
•YouTube Shorts
•Douyin
•Xiaohongshu
•自定义网站


工作原理

ThinkBreak 通过 DOM 结构和 UI 信号 来判断 AI 是否正在生成回复。

插件并不依赖任何官方 API，而是通过观察页面状态来推断。

主要检测信号包括：

•页面是否出现“停止生成”按钮
•页面是否存在忙碌状态
•AI 回复文本是否持续变化
•输入框是否恢复可交互
•页面是否出现复制 / 重新生成等完成 UI

通过组合多种信号来提高判断准确性。



状态模型

页面状态：

type AIPageState =
  | "UNKNOWN"
  | "IDLE"
  | "GENERATING"
  | "FINISHED";

后台会话状态：

type SessionState = {
  platform: "chatgpt" | "claude" | "gemini" | "grok" | "codex" | null;
  aiTabId: number | null;
  aiWindowId: number | null;
  shortTabId: number | null;
  shortWindowId: number | null;
  hasRedirected: boolean;
  startedAt: number | null;
  finishedAt: number | null;
};




检测稳定策略

为了减少误判，ThinkBreak 会组合多个信号进行判断。

生成信号
•出现停止生成按钮
•页面进入忙碌状态
•AI 回复文本持续变化
•用户刚刚发送消息

完成信号
•停止按钮消失
•AI 回复文本在 2500ms 内保持稳定
•输入框恢复可交互
•页面出现重新生成或复制按钮

⸻

架构

ThinkBreak 采用模块化浏览器插件架构。

content scripts
      │
      ▼
AI detector 模块
      │
      ▼
background service worker
      │
      ▼
tab 管理与 session 状态

主要模块：

Background / Service Worker

负责：
•会话状态管理
•自动跳转逻辑
•标签页切换

Content Scripts

负责各 AI 平台的状态检测：
•ChatGPT detector
•Claude detector
•Gemini detector
•Grok detector

Popup

负责：
•用户设置
•状态展示
•调试控制


已知限制
•ThinkBreak 通过 DOM 结构推断 AI 状态，而不是官方 API。
•如果 AI 网站修改前端结构，可能需要更新 selector。
•当前仅支持 网页版本 AI。
•不支持 AI 桌面应用版本。



未来计划

Phase 2
•提升 Claude / Gemini / Grok 检测稳定性
•在 Popup 中增加调试面板
•优化多平台调度策略

Phase 3

•自动化测试
•更完善的 selector fallback 机制


许可证

Apache License 2.0 License
