<div align="center">

# DevX

### 7×24 小时桌面 AI Agent —— AI that gets things done

让 AI 真正帮你做事。写代码、建应用、做研究、写报告、部署服务器、操控浏览器 —— 凡是 Agent 能做的，DevX 都能做。

无需命令行，无需配置环境，下载即用。

</div>

---

## 为什么是 DevX？

DevX 由 Claude Code 驱动，拥有与 Claude Code 同等强大的 Agent 能力。

不同的是，DevX 把这份能力从终端带到了完整的图形界面中 —— 不再需要盯着命令行输出，不再需要手写提示词，不再需要等待任务完成后才知道结果。打开即用，所见即所得。
<img width="1000" height="650" alt="image" src="https://github.com/user-attachments/assets/25282544-203c-4412-88a3-ccbc9689de06" />
<img width="1000" height="650" alt="image" src="https://github.com/user-attachments/assets/b548bb4c-8a60-4ebd-8244-6d339fce61f4" />

---

## 核心功能

- **真正的 Agent 循环** — 不只是聊天。写代码、创建文件、执行命令、持续迭代，直到任务完成
- **空间系统** — 隔离的工作空间，每个空间有独立的文件、对话和上下文
- **AI 浏览器** — AI 控制真实的内嵌浏览器，自动完成网页抓取、表单填写、端到端测试
- **远程访问** — 从手机或任何浏览器控制桌面 DevX，随时随地工作
- **数字人系统** — 创建自主运行的 AI Agent，按计划或事件触发，后台自动执行
- **Skills 技能市场** — 为 Agent 安装专属技能包，扩展能力边界
- **实时思考过程** — 观看 AI 的思考链条，理解每一步决策
- **多模型支持** — Anthropic、OpenAI、DeepSeek 以及任何 OpenAI 兼容 API

---

## 技术栈

- **架构**: Electron 29 + React 18 + TypeScript + Vite 5
- **AI 引擎**: Claude Code SDK
- **数据**: 纯本地存储，你的数据不会离开你的电脑
- **构建**: electron-vite + electron-builder（支持 macOS / Windows / Linux）

---

## 从源码构建

```bash
git clone https://github.com/devx.git
cd devx
npm install  #安装依赖包
npm run prepare #安装平台相关的二进制依赖
npm run dev
```

## 打桌面安装包
- 前置执行
```
npm install  #安装依赖包
npm run prepare #安装平台相关的二进制依赖
```
- macOS（当前机器架构，Apple Silicon 下为 arm64）
```
npm run build:mac
```
- macOS Intel x64
```
npm run build:mac-x64
```
- Windows
```
npm run build:win
```
- Windows x64（明确指定）
```
npm run build:win-x64
```
- Linux
```
npm run build:linux
```
