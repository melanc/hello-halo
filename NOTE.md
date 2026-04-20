根据仓库里的 package.json 和 中文 README，这个 Halo 项目是 Node.js + Electron（用 electron-vite 打包源码），构建方式可以分成几类：
1. 日常开发（本地跑起来）

npm install
npm run prepare        # 拉取当前平台的二进制依赖
npm run dev

npm install 会触发 postinstall（含 patch-package、Electron 相关依赖安装、以及对 better-sqlite3 的 electron-rebuild），需要本机有合适的 Node.js 和构建环境（原生模块常见要求）。
若要为所有目标平台打安装包，文档建议先执行：
npm run prepare:all

2. 只编译（不打出安装包）
npm run build

对应脚本里是 electron-vite build，产物在配置的输出目录（主进程入口在 package.json 里写的是 ./out/main/index.mjs）。

3. 打桌面安装包（electron-builder）
在对应系统上执行，例如：
```
# macOS（当前机器架构，Apple Silicon 下为 arm64）
npm run build:mac
# macOS Intel x64
npm run build:mac-x64
# Windows
npm run build:win
# Windows x64（明确指定）
npm run build:win-x64
# Linux
npm run build:linux
```
这些脚本会先 bump-rc、再 npm run build、再跑 electron-builder。发布相关还有 release、release:mac 等。

4. 移动端（Capacitor）
先构建 Web 资源：npm run build:mobile
同步到原生工程：npm run cap:sync
Android/iOS 还有 cap:run:android、cap:run:ios、build:android:debug、release:android 等（Android 脚本里示例用了 ANDROID_HOME）。
简要对照：想改代码调试 → install + prepare + dev；想确认能编过 → build；想得到 .dmg/.exe/.AppImage → 用各平台的 build:*；想多端打包 → 先 prepare:all。更细的贡献流程可见仓库根目录的 CONTRIBUTING.md。

-------
## 任务的5个流程

这个文件里一共有 7 个发给 AI 的提示词函数，覆盖 5 个 Pipeline Tab，下面按顺序梳理：

公共部分（每条消息都带）
角色前缀 ROLE_PREAMBLE（第 165 行）


你是一名软件需求开发工程师，你的职责是：识别和分析需求、拆解开发任务、生成开发计划、指导代码实现。
语言约束 — 尽量用简体中文，代码块/路径/标识符除外。

Tab 1 — 需求识别
意图识别 buildIntentAnalysisMessage (case 1)

分析需求 → 告诉我：你理解的背景目标、打算提取哪些功能要点、有哪些不清楚需要确认。附带任务名、需求内容。

开始工作 buildRequirementIdentifyMessage

如有知识库路径：先用工具浏览目录，找需求识别引导文件，按规范处理。 输出结构：①需求背景与目标 ②核心功能要点（- 列表）③涉及系统模块 ④注意事项/风险。

Tab 2 — 任务拆解
意图识别 buildIntentAnalysisMessage (case 2)

根据需求要点，列出拆解方案：打算拆哪些子任务、依赖关系和顺序、有哪些不确定需确认。

开始工作 buildTaskBreakdownExecuteMessage

如有知识库路径：先找任务拆解引导文件。 格式要求：按**"要做的事"**分组（## 分组名），每条任务格式为： - 任务名 (项目A, 项目B): 说明，括号写涉及的项目名。

Tab 3 — 开发计划
意图识别 buildIntentAnalysisMessage (case 3)

根据子任务列表，说明开发计划：涉及哪些项目/模块、主要改动范围和思路、需用户确认或存在风险的地方。

开始工作 buildDevPlanExecuteMessage

如有知识库路径：先找开发计划引导文件。 两段式输出：

第一部分 ## 各项目改动点：每个项目用 ### 项目名，下面列改动 bullet
第二部分 ## 整体改动说明：整体改动范围自然语言描述

Tab 4 — 编码实现
意图识别 buildIntentAnalysisMessage (case 4)（英文）

审阅开发计划 + 子任务完成状态，判断还有多少工作：①已完成/未完成定论 ②如有遗留：具体下一步和涉及文件 ③开始前的风险/问题。输出当前 coding slice 的 "planned changes"，不要改文件。附带：开发计划全文、分支名、项目路径、子任务进度看板。

开始工作 buildCodingKickoffMessage

如有知识库路径：先找编码规范引导文件。 进入编码阶段，按开发计划逐步改动，每完成一个模块简要说明，遇到不确定先列问题。 附带：任务名、分支、workspace 路径、项目路径、开发计划全文、子任务进度看板。 要求：先实现 pending/in_progress 子任务，全部完成则确认计划是否有遗漏，改完后提醒用户勾选子任务。

Tab 5 — 用例验证
意图识别 buildIntentAnalysisMessage (case 5)

说明用例验证计划：检查哪些逻辑和边界、运行哪些测试、有哪些已知风险。

开始工作 buildTaskCompletionMemoryMessage

读取空间记忆文件（.devx/memory.md）→ 在 # History 区块顶部插入本次任务记录：需求摘要 / 子任务列表 / 开发计划要点 / 经验教训。附带任务名、需求要点、子任务列表、开发计划。

其他（非 Pipeline 主流程）
buildWorkspaceTaskComposerReferenceLabel — 普通对话时插入任务引用 chip
buildImplementationPlanKickoffMessage — 老的两阶段实现（Plan → Confirm → Code）
buildSubTaskComposerReferenceLabel / buildSubTaskImplementationPlanKickoffMessage — 针对单个子任务的实现流程