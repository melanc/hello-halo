
# 需求开发Agent 核心流程

- 我是一名Golang后端开发工程师。我现在基于claude agent sdk开发了一个需求开发Agent。
- 主要流程是上传一个需求文档，先识别出来需求要点，然后拆解任务、生成开发计划，最后是编码实现。
- 下面是Agent开发的一个大致框架，帮我看看哪些是我需要关注的：

## 1. 需求与能力定义
- 明确Agent主要能力：把日常的需求开发，抽象出来4大阶段，形成流水线：需求识别、任务拆解、计划+实现、用例验证
- 是否需要多轮对话、长期记忆：需要多轮对话和长期记忆
- 设定约束：
  - 权限边界：目前执行命令的权限很大，基本是全部权限，没有作限制。
  - 安全规则：①只能修改当前空间，被选择到的项目 ②修改代码前，会给出弹窗，让用户确认。
  - 输出格式：大多数使用MD格式，然后进行格式渲染。

## 2. 架构设计（核心三组件）
1. **大脑（LLM）**
负责理解、推理、规划、决策
2. **记忆模块**
- 短期记忆：对话上下文
- 长期记忆：
  - 任务相关的信息，存储到本地SQLite，文件 ~/.devx/devx.db。
  - 本地知识库。任务过程中梳理的项目内容，自动回写到知识库中。需求开发的总结内容等变更日志，也会写到知识库中
3. **工具执行层**
- 三大基础工具 Read、Edit、Write，使Task任务具备查看文件、修改文件的能力。
- 文件检索 glob，文件内容检索 grep。
- 其他bash命令，都可以使用，不限制。
- 联网搜索，使用ai_browser去网上查找信息。

> 经典结构：**感知 → 思考 → 规划 → 行动 → 反思 → 迭代**

## 3. 提示词工程（Prompting）
设计 Agent 核心指令：
- 角色设定：后端Golang开发，需求开发。
- 任务目标
- 思考格式：Agent Loop
- 工具调用规则
- 输出约束与格式

主流范式：
- **ReAct**：Reason + Act 边思考边行动
- **CoT**：思维链
- **Agent Loop**：Thought -> Action -> Observation -> 重复

## 4. 工具接入与函数调用
1. 定义工具清单（搜索、计算器、API、数据库等）
2. 标准化工具描述（供 LLM 选择）
3. 实现调用链路：
LLM → 选择工具 → 生成参数 → 执行 → 获取结果 → 继续推理

## 5. 流程编排（Planning）
复杂任务必须做**任务拆解与执行计划**：
- 单步任务：直接执行
- 多步复杂任务：Plan Mode模式。先生成执行计划，细化到文件代码级的改动，研发人员确认后，再执行编码实现。
- 执行顺序调度：多项目，通过子Agent并行执行。最后全部执行完成后，汇总结果。
- 异常处理与重试：代码修改完成后，自动检查语法错误。

常见编排方式：
- 固定流程
- LLM 自主规划

## 6. 反思、评估与迭代
- 执行结果自检（Self-Correction）
- 效果评估：准确率、完成率、步骤合理性、安全性
- 迭代优化：
- 优化 Prompt
- 优化工具选择策略
- 优化记忆召回
- 加入人类反馈（RLHF）

=================
DevX 的渲染层是 React + TypeScript，基于 Electron。具体来说：

渲染层（你看到的界面）

React 18
TypeScript
Tailwind CSS（样式）
Zustand（状态管理）
Vite（构建）
主进程（后台逻辑）

Node.js + TypeScript
Electron IPC 通信
数据层

better-sqlite3（本地数据库）

=================
# devx任务流水线

## 任务接入工具
- Claude Agent SDK 本身具备工具能力。任务管道的 Prompt 告诉 AI 要去使用这些工具。

工具层接入（最关键）
├── read_file / list_dir   ← AI 能看到代码
├── edit_file / write_file ← AI 能修改代码  
├── bash / exec            ← AI 能跑命令
└── Observation 回传       ← 结果反馈给 AI 继续推理
自动循环
└── 执行完一步自动判断是否继续，而不是等人点击
这其实就是 Claude Code 本身的工作原理。

## 集成文本编辑器
- 右侧增加文件导航栏，可以浏览空间下面的所有目录。
- 点击某个文件，可以在文本编辑器中查看、编辑、保存文件。

## 集成Git操作
- 支持分支切换、创建，拉取更新、提交和推送更新。
- 查看文件Diff。自动展示当前空间下，所有发生过修改的文件。点击文件，文本编辑器中展示Diff。
- 集成glab命令: glab auth login --hostname git.100tal.com --token <your_access_token>
- 安装glab，并新建glab skills。下载地址 https://gitlab.com/gitlab-org/cli/-/releases

## 集成知识库
- 任务可以绑定知识库目录。4个阶段执行过程中，都可以扫描知识库中已有的内容。
- 项目梳理的结果，AI会自动会写到知识库中。代码修改的关键细节，也会自动归档到知识库中。

## 集成AI Browser
- 集成了浏览器搜索网络的能力。可以联网搜索网络上的文档。

## 数据持久化
- 任务数据，保存在本地 ~/.devx/devx.db
- 项目知识，保存在本地知识库目录下面。

## 任务的流水线设计
- 需求识别：
- 任务拆解：
- 计划与实现：采用两阶段 Plan Mode模式。
- 用例验证：


=================
Plan Mode 设计方案
问题背景
当前编码阶段：点击「开始工作」→ AI 直接开始改文件。虽然有 announce_file_changes 做每次改动前确认，但没有一个"全局视角"——用户无法在 AI 动手之前看到它准备做什么、涉及哪些文件、改动范围多大。

核心思路：两阶段执行


阶段一：规划（Plan）
  [生成执行计划] → AI 分析任务、输出改动清单 → 不碰任何文件
                                ↓
              Tab4 显示「执行计划已就绪」
                ↙              ↓              ↘
          [确认执行]        [重新规划]          [放弃]
                ↓
阶段二：执行（Execute）
  AI 按照已确认的计划写代码（同时 announce_file_changes 仍然生效）
状态机
编码 Tab 本地状态（不需要持久化到 store）：



idle         → 点击「生成执行计划」
  ↓
planning     → AI 正在生成计划（loading）
  ↓
plan_ready   → 计划生成完毕，等待用户确认
  ↓
executing    → AI 正在写代码
  ↓
idle         → 完成
计划文本从最后一条 AI 消息中直接读取，不需要额外字段存储（或可选存为 pipelineCodingPlan 用于展示）。

--------------

合并方案：计划与实现
核心变化
Tab3（开发计划）+ Tab4（编码实现）→ 合并为 Tab3「计划与实现」

Tab 栏从 5 个变为 4 个（Stage 4 内部仍保留用于状态追踪，但不再显示为独立 Tab）：



需求识别 → 任务拆解 → 计划与实现 → 用例验证
  (1)         (2)         (3)          (5)
Tab 布局（从上到下）


┌─────────────────────────────────────┐
│ 涉及项目                             │  ← 可增删（来自 Tab3）
│ [talcamp ×] [vote-service ×] [+2个] │
├─────────────────────────────────────┤
│ 涉及项目路径                          │  ← 只读，显示完整路径（来自 Tab4）
│ - /workspace/talcamp                │
├─────────────────────────────────────┤
│ 开发分支                             │  ← 可编辑（来自 Tab3）
│ [feature/xxx____________]           │
├─────────────────────────────────────┤
│ 代码改动计划            [编辑/预览]   │  ← 核心区域（升级版 Tab3）
│                                     │
│  ## talcamp                         │
│  - src/handlers/gently.go           │
│    修正 import 路径，移除 plog 引用  │
│  - src/utils/plog.go  (删除)        │
│                                     │
│  ## vote-service                    │
│  - internal/server/register.go      │
│    修正 ZK 注册服务名               │
├─────────────────────────────────────┤
│ 编码活动日志                          │  ← 来自 Tab4
│ [2024-06-25 14:22] 开始编码...      │
└─────────────────────────────────────┘
两个操作按钮
Tab 对应两个动作，通过「意图识别/开始工作」按钮区区分：

状态	按钮文案	触发动作
无计划	生成计划	发 prompt → AI 输出文件级改动计划
计划已有	开始编码	发 coding kickoff → AI 写代码
编码中	loading...	—
两个动作都在 Stage 3 这个 Tab 内完成，不跳 Tab。内部 Stage 从 3 推进到 4 时，只影响日志显示和 isDone 状态，Tab 不切换。

计划 Prompt 升级（核心改动）
把 buildDevPlanExecuteMessage 的输出格式从模块级升级到文件级：

当前格式（模块级）：

markdown


## 各项目改动点
### talcamp
- 修复 gently handler 中的 import 引用
升级后格式（文件级）：

markdown


## talcamp
- `src/handlers/gently.go` — 修正 import 路径（第 12 行）
- `src/utils/plog.go` — 删除整个文件（移除埋点模块）
## vote-service
- `internal/server/register.go` — 修正 ZK 注册服务名（第 34 行）
改动范围
文件	改动说明
TaskPipelinePanel.tsx	STAGES 重命名 stage 3；visibleStageIds 改为 [1,2,3,5]；合并 Tab3+Tab4 为新 Tab3PlanAndImpl 组件
workspace-task-messages.ts	升级 buildDevPlanExecuteMessage 的输出格式要求为文件级
类型和 store 不需要改动，stage 4 继续存在只是不展示。

-------------
不是 Plan Mode 模式（那个需要调用 Claude Agent SDK 的特殊接口）。Tab3 的实现方式是普通的分步对话：

生成计划阶段（点击「生成计划」）：

发送 buildDevPlanExecuteMessage 提示词，要求 AI 先探索代码，再按 ## 项目名 / - \文件路径` — 改动说明` 格式输出计划
AI 的回复保存到 task.pipelineDevPlan 字段，并渲染为可交互的 checkbox 列表
编码阶段（点击「开始编码」）：

会读取 task.pipelineDevPlan，并根据 checkbox/done 状态过滤出要执行的条目
将过滤后的计划通过 buildCodingKickoffMessage 作为 开发计划： 段落注入到编码提示词中
AI 收到的 prompt 里会包含完整的文件级改动清单，按清单执行代码修改
所以本质上是：一次对话生成计划 → 存储 → 下一次对话把计划作为上下文传给 AI 执行。

与 Plan Mode 的区别在于：Plan Mode 是 Claude Agent SDK 的工作模式切换（让 agent 先规划再执行，是一个原子操作）；而现在的实现是两个独立的对话轮次，中间由用户确认计划后手动触发编码。

=================
我当前可用的工具分几类：

文件操作

Read — 读文件
Write — 写文件
Edit — 精确替换文件内容
Glob — 文件路径匹配
Grep — 正则搜索文件内容
系统命令

Bash — 执行任意 shell 命令（curl、git、npm、go、brew 等都通过它运行）
AI 浏览器

mcp__ai-browser__* — 控制内嵌浏览器（打开页面、点击、截图等）
任务管理

Task — 启动子 Agent（Bash/Explore/Plan/web-searcher 等专用 Agent）
TodoWrite — 管理待办列表
其他

WebFetch / WebSearch — 网络请求/搜索
AskUserQuestion — 向你提问
Skill — 调用已安装的技能
在哪里管理？

目前这些工具是由 DevX 平台内置提供的，没有单独的 UI 面板来启用/禁用单个工具。

不过有两个相关入口：

Settings > Remote Access — 控制是否允许远程 HTTP 访问
Hooks（钩子） — Settings 里可以配置 shell 命令，在特定事件（如工具调用前后）触发，可以用来拦截或限制特定工具的行为
如果你想限制某类工具的使用（比如禁止 Bash 执行某些命令），目前最直接的方式是通过 Hooks 来实现拦截逻辑。

===============

# DevX 任务系统技术文档

## 目录

1. [整体概览](#1-整体概览)
2. [数据模型](#2-数据模型)
3. [任务创建流程](#3-任务创建流程)
4. [五阶段流水线](#4-五阶段流水线)
5. [UI 架构](#5-ui-架构)
6. [Store 层](#6-store-层)
7. [提示词系统](#7-提示词系统)
8. [AI 响应解析](#8-ai-响应解析)
9. [亮点技术实现](#9-亮点技术实现)
10. [Claude Agent SDK 集成](#10-claude-agent-sdk-集成)
11. [知识库集成](#11-知识库集成)
12. [数据持久化](#12-数据持久化)

---

我来梳理下午新增的特性，然后更新文档：

**下午新增特性清单：**
1. Sub-agent 并行处理（多项目 Tab 4 提示词）
2. Tab 4 执行要求：动态探索代码 + 改动预告
3. Tab 3 无知识库时的动态探索分支
4. 简单任务在 Tab 4 配置涉及项目和分支（UI）
5. 任务切换时会话面板跟随切换
6. 切换会话时草稿保留
7. 删除确认提示改为中文

需要更新的位置：Section 2.1（数据模型）、Section 4（流水线 prereqs + Tab 3 流程图）、Section 5（UI 架构）、Section 7（提示词描述 + Tab 3 KB 逻辑）、Section 9（新增三个亮点）。

---

## 1. 整体概览

任务系统是 DevX 的核心功能，将一个开发需求拆解为五个有序的 AI 辅助阶段，每个阶段通过向绑定会话发送结构化提示词来驱动 AI 完成对应工作。

```
需求文档/描述
      ↓
┌─────────────────────────────────────────────┐
│             TaskPipelinePanel               │
│                                             │
│  Tab1     Tab2     Tab3     Tab4     Tab5   │
│ 需求识别 任务拆解 开发计划 编码实现 用例验证  │
└─────────────────────────────────────────────┘
      ↓           ↓           ↓
  提示词构建   AI 响应解析   状态持久化
      ↓
  Chat 会话（绑定的 Conversation）
```

每个任务绑定一个唯一的会话（`conversationId`），所有阶段的 AI 交互都在同一会话内进行，保持上下文连贯。

---

## 2. 数据模型

### 2.1 WorkspaceTask — 核心实体

```typescript
interface WorkspaceTask {
  // ── 基础信息 ──
  id: string;                       // "task-<timestamp>-<random8>"
  name: string;                     // 任务名称
  spaceId: string;                  // 代码工作区 ID
  knowledgeBaseSpaceId?: string;    // 关联知识库空间 ID（可选）
  conversationId: string;           // 绑定的 Chat 会话 ID
  branchName: string;               // 开发分支名（跨项目共用）
  taskType?: 'simple' | 'complex';  // 简单任务跳过 Tab 2/3，直接进 Tab 4
  createdAt?: number;
  updatedAt: number;

  // ── 需求原材料 ──
  requirementDocName: string;       // 上传的 .docx 文件名
  requirementDocContent: string;    // .docx 提取的纯文本
  requirementDescription?: string; // 手动输入的需求描述

  // ── Tab 1 产出 ──
  requirementKeyPoints?: string[];  // AI 识别的需求要点列表
  requirementAnalysis?: string;     // AI 输出的四段式需求分析全文

  // ── Tab 2 产出 ──
  pipelineSubtasks?: PipelineSubtask[];  // 结构化子任务列表

  // ── Tab 3 产出 ──
  pipelineDevPlan?: string;              // 整体改动说明（Markdown）
  pipelineProjectChanges?: string;       // 各项目改动点（Markdown）

  // ── Tab 4 运行时 ──
  pipelineCodingLogLines?: string[];     // 编码活动日志（最多 80 条）
  touchedProjectDirs?: string[];         // 实际改动过的顶级目录（artifact 事件自动记录）

  // ── Tab 5 配置 ──
  pipelineDepCheckCmd?: string;          // 依赖检查命令（如 go mod tidy）
  pipelineBuildCheckCmd?: string;        // 编译检查命令（如 make）
  pipelineApiTestCmd?: string;           // 接口用例验证（curl 命令）

  // ── 流水线元数据 ──
  pipelineStage?: PipelineStage;         // 当前进度（1-5）
  pipelineResumeHint?: string;           // 状态描述（显示在按钮旁）
  projectDirs: string[];                 // 用户手动添加的涉及项目目录
}
```

### 2.2 PipelineSubtask — 子任务

```typescript
type PipelineStage = 1 | 2 | 3 | 4 | 5
type PipelineSubtaskStatus = 'pending' | 'in_progress' | 'done'

interface PipelineSubtask {
  id: string;                      // "st-<timestamp>-<idx>"
  title: string;                   // 子任务标题
  description: string;             // 简要说明
  status: PipelineSubtaskStatus;   // 用户手动勾选
  group?: string;                  // 所属分组（AI 分配，如"修复编译问题"）
  projects?: string[];             // 涉及的项目名（如 ["my-service", "api-gateway"]）
}
```

---

## 3. 任务创建流程

### 3.1 入口

在 `HomeTasksPanel` 中点击右上角"新建"按钮，弹出创建对话框。如果没有可用的工作区 Space，按钮处于 disabled 状态。
```
创建空间
  └─ 选择项目根目录（代码所在位置）
  └─ [可选] 再创建一个知识库空间（存放 .md 引导文档）
    ↓
新建任务
  ├─ 任务名称
  ├─ 任务类型（简单 / 复杂）
  │     ├─ 简单：仅 Tab 1 → Tab 4 → Tab 5（跳过 Tab 2/3）
  │     └─ 复杂：完整五阶段流水线
  ├─ 需求来源（二选一）
  │     ├─ 上传 .docx → mammoth.js 提取纯文本
  │     └─ 手动输入需求描述
  ├─ 选择空间（代码工作区）
  └─ 选择知识库（可选）
    ↓
确认创建
  ├─ 自动创建绑定的 Chat 会话
  ├─ 生成 WorkspaceTask 对象
  └─ 持久化到 localStorage
    ↓
进入 Tab 1 — 需求识别
```

创建完成后，面板自动切换到 Tab 1（需求识别）准备开始工作。

---

## 4. 五阶段流水线

### 流程总览

```
阶段 1：需求识别
  意图识别（可选）→ 交互对话 → 开始工作 → 保存 requirementAnalysis
        ↓
阶段 2：任务拆解（复杂任务）
  开始工作 → AI 输出格式化列表 → 解析为 PipelineSubtask[] → 保存
        ↓
阶段 3：开发计划（复杂任务）
  开始工作 → AI 查阅/写入 KB（或动态探索代码） → 输出两段式计划 → 解析保存
        ↓
阶段 4：编码实现
  开始工作（fire-and-forget）→ AI 探索代码结构 → 输出改动预告 → 开始改代码
        ↓
阶段 5：用例验证
  开始工作（fire-and-forget）→ AI 执行检查命令 → 综合评估
```

### 各阶段前置检查

| 阶段 | 前置条件（复杂任务） | 前置条件（简单任务） |
|------|------|------|
| Tab 1 | 有 `requirementDocName` 或 `requirementDescription` | 同左 |
| Tab 2 | 有 `requirementAnalysis`（Tab 1 已完成） | —（跳过） |
| Tab 3 | 有 `pipelineSubtasks`（Tab 2 已完成） | — （跳过） |
| Tab 4 | 有 `pipelineDevPlan` + `projectDirs` + `branchName` | 有 `requirementAnalysis`（可在 Tab 4 内配置 projectDirs / branchName） |
| Tab 5 | `pipelineStage >= 4` | 同左 |

### 各阶段 AI 交互方式

| 阶段 | 等待 AI 回复 | 回复处理 |
|------|------------|---------|
| Tab 1 | 是（Zustand 订阅，90s 超时） | 整体保存为 `requirementAnalysis` |
| Tab 2 | 是（Zustand 订阅，90s 超时） | 解析 Markdown 列表 → `PipelineSubtask[]` |
| Tab 3 | 是（Zustand 订阅，90s 超时） | 解析两个 `##` 段落 → devPlan + projectChanges |
| Tab 4 | 否（fire-and-forget） | 用户自行查看会话 |
| Tab 5 | 否（fire-and-forget） | 用户自行查看会话 |

---

## 5. UI 架构

### 组件树

```
TaskPipelinePanel（exported）
  └── TaskPipelinePanelInner
        ├── StageTabBar（进度条 + Tab 导航）
        ├── [Tab 内容区，按 selectedTab 切换]
        │     ├── Tab1Requirements
        │     ├── Tab2Breakdown
        │     │     └── SubtaskItem × N（支持勾选/编辑/删除）
        │     ├── Tab3DevPlan
        │     ├── Tab4Coding
        │     │     └── 简单任务：内嵌涉及项目选择器 + 分支输入框
        │     └── Tab5Review
        └── [操作行]
              ├── 意图识别（仅 Tab 1 显示）
              └── 开始工作
```

### SubtaskItem 状态机

```
pending ──[勾选]──→ done
done    ──[取消]──→ pending
任意    ──[点铅笔]──→ isEditing=true
isEditing ──[Save]──→ 调用 onEdit()
isEditing ──[Cancel / 空标题]──→ 调用 onRemove()
任意    ──[点 X]──→ 调用 onRemove()
```

### 意图识别 vs 开始工作

| | 意图识别 | 开始工作 |
|-|---------|---------|
| 显示 | 仅 Tab 1 | 所有 Tab |
| 作用 | 发起规划/讨论，引发 AI 多轮交互 | 发送执行提示，解析 AI 输出并写入 Store |
| 等待回复 | 否（用户继续对话） | Tab 1-3 是，Tab 4-5 否 |
| 修改 Store | 否 | 是 |

### 任务切换与会话联动

左侧任务列表点击任务时，右侧会话面板自动切换到该任务绑定的会话。实现方式：在 `SpacePage` 中监听 `activeTaskId` 变化，当任务属于当前空间且目标会话存在时，调用 `selectConversation()` 主动切换。

### 会话草稿保留

每个会话的输入框草稿独立保存，切换任务后回来，已输入内容不丢失。实现方式：在 `ChatView` 中维护一个 `Map<conversationId, draft>` ref，输入框通过 `key={conversationId}` 强制重挂，挂载时读取对应草稿作为初始值，内容变化时回写 Map。

---

## 6. Store 层

**文件**：`src/renderer/stores/task.store.ts`

**持久化**：Zustand `persist` 中间件，key `devx-workspace-tasks-v1`，只持久化 `tasks[]`，`activeTaskId` 等会话状态不持久化。

### 主要 Actions

| Action | 作用 |
|--------|------|
| `addTask(input)` | 创建 Chat 会话 + 新建任务 |
| `removeTask(id)` | 删除任务 |
| `updateTaskRequirementDoc(...)` | 更新需求文档，重置 Tab 1-2 产出 |
| `updateTaskPipelineState(id, updates)` | **核心更新入口**：可更新 stage、子任务、开发计划、检查命令等 |
| `updateTaskRequirementAnalysis(id, text)` | 保存 Tab 1 产出 |
| `appendPipelineCodingLog(id, line)` | 追加编码日志（上限 80 条） |
| `recordArtifactTouch(spaceId, path)` | 自动记录 AI 改动的项目目录 |
| `moveTaskToSpace(taskId, newSpaceId)` | 迁移任务到新 Space，重置所有流水线状态 |
| `updateTaskKnowledgeBaseSpaceId(...)` | 绑定/解绑知识库空间 |
| `addProjectDirToTask(id, dir)` | 添加涉及项目目录（简单任务在 Tab 4 使用） |
| `removeProjectDirFromTask(id, dir)` | 移除涉及项目目录 |
| `updateTaskBranchName(id, branch)` | 更新开发分支名 |

---

## 7. 提示词系统

**文件**：`src/renderer/lib/workspace-task-messages.ts`

### 公共开头（所有提示词均以此开始）

```
你是一名软件需求开发工程师，你的职责是：识别和分析需求、拆解开发任务、生成开发计划、指导代码实现。

请全程使用中文与我交流（代码块、文件路径、标识符及不可避免的英文技术术语除外）。
```

### 各阶段提示词函数

| 函数 | 对应阶段 | 核心内容 |
|------|---------|---------|
| `buildIntentAnalysisMessage` | Tab 1 意图识别 | 两步式需求理解：整体概括确认 → 逐条子需求梳理 |
| `buildRequirementIdentifyMessage` | Tab 1 开始工作 | 输出四段式结构化需求分析 |
| `buildTaskBreakdownExecuteMessage` | Tab 2 开始工作 | 输出严格格式子任务列表，含正确/错误示例约束 |
| `buildDevPlanExecuteMessage` | Tab 3 开始工作 | 有 KB：查阅/创建项目知识文档后生成计划；无 KB：先动态探索项目代码结构，再输出两段式计划 |
| `buildCodingKickoffMessage` | Tab 4 开始工作 | 动态探索代码结构 → 改动预告 → 按计划实现；多项目时通过 Task 工具并行派发子 Agent |
| `buildVerificationExecuteMessage` | Tab 5 开始工作 | 依次执行语法/依赖/编译/接口验证；综合评估 |
| `buildTaskCompletionMemoryMessage` | 任务收尾 | 将结论写入空间记忆文件的 `# History` 区块 |

### Tab 3 开发计划生成逻辑

```
有 knowledgeBaseRoot？
  ↓ 是
  遍历涉及项目
    → 在 {kbRoot}/项目介绍/ 下找 {项目名}技术知识.md
      ↓ 找到 → 阅读内容
      ↓ 未找到 → Glob 浏览代码目录 → 梳理架构
               → 写入 {kbRoot}/项目介绍/{项目名}技术知识.md
  基于知识文档生成开发计划
  ↓ 否
  动态探索项目代码：
    1. Glob 浏览涉及项目目录结构，了解架构和核心模块
    2. 按需读取关键文件（路由入口、核心业务逻辑、接口定义等）
    3. 基于实际代码结构制定计划，不假设文件位置或接口
```

### Tab 4 编码执行要求

```
1. 动态探索代码：先用 Glob/Grep 了解目录结构和关键模块，按需读取文件后再开始修改
2. 改动预告：修改任何文件之前，先列出计划修改的文件及每个文件的改动原因
3. 按照开发计划中的模块和文件范围进行修改
4. 每完成一个模块或文件，简要说明改动内容
5. 遇到不确定的地方，先列出问题再继续

多项目时追加：
  → 使用 Task 工具为每个项目路径启动独立子 Agent 并行处理
  → 每个子 Agent 的 prompt 包含：项目路径、完整开发计划、分支名、子任务上下文
  → 子 Agent 只在对应项目范围内修改
  → 等所有子 Agent 完成后汇总报告
```

---

## 8. AI 响应解析

### Tab 2：子任务解析

**期望格式：**
```markdown
## 修复编译问题
- 修复 handler 的 import (my-service): 补全缺失的包引用
- 修复 ZK 注册服务名 (user-service, api-gateway): 改为正确的服务名
```

**解析规则：**
- `#` / `##` / `###` 标题 → `group` 字段
- `- Title (proj1, proj2): description` → 一条 `PipelineSubtask`
- 括号内逗号分隔 → `projects[]`
- 冒号后（含全角冒号`：`）→ `description`
- 空标题或标题 ≥ 200 字符的行静默丢弃

### Tab 3：开发计划解析

```
AI 回复
  ├── ## 各项目改动点 / ## Per-project Changes
  │     → pipelineProjectChanges
  └── ## 整体改动说明 / ## Overall
        → pipelineDevPlan
```

未找到任何 `##` 标记时，整段回复作为 `pipelineDevPlan`。

---

## 9. 亮点技术实现

### 9.1 waitForAssistantReply — 响应式等待，非轮询

Tab 1-3 的"开始工作"需要等待 AI 回复后才能解析结果。这里没有使用定时器轮询，而是利用 **Zustand 的 `subscribe()`** 实现响应式推送：

```typescript
function waitForAssistantReply(conversationId: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(undefined), 90_000)  // 兜底超时

    const unsub = useChatStore.subscribe((state) => {
      const session = state.sessions.get(conversationId)
      if (!session?.isGenerating) {           // AI 停止生成时触发
        const msgs = conversationCache.get(conversationId)?.messages ?? []
        const last = [...msgs].reverse().find(m => m.role === 'assistant')
        done(last?.content)
      }
    })

    // 竞态守卫：订阅前若已完成，直接 resolve
    const sess = useChatStore.getState().sessions.get(conversationId)
    if (!sess?.isGenerating) { /* 立即取最后一条 resolve */ }
  })
}
```

关键点：
- **零延迟响应**：AI 一停止生成立即触发，不存在轮询间隔带来的延迟
- **竞态守卫**：先注册 subscribe 再检查当前状态，避免"订阅时 AI 已完成"的丢失事件
- **90s 安全兜底**：防止 AI 意外卡住导致 UI 永久 loading

### 9.2 extractSubtasks — 鲁棒的格式解析

提示词要求 AI 输出严格格式，但实际输出存在变体。解析器做了多项兼容处理：

```typescript
// 支持 #、##、### 三级标题作为分组
const groupMatch = line.match(/^#{1,3}\s+(.+)/)

// 支持 -、•、* 三种 bullet 符号
if (/^\s*[-•*]\s+.+/.test(line)) { ... }

// 同时识别 ASCII 冒号 : 和全角冒号 ：
const colonIdx = raw.search(/[:：]/)

// 项目名提取（含括号内逗号分隔）
const projMatch = rawTitle.match(/^(.*?)\s*\(([^)]+)\)\s*$/)

// 标题长度守卫，过滤代码片段等误识别（< 200 字符）
if (title.length > 0 && title.length < 200) { result.push(...) }
```

配合提示词里的正确/错误示例约束，AI 输出质量和解析成功率都很高。

### 9.3 Artifact 自动追踪项目目录

Tab 4 编码阶段，AI 会改动多个项目的文件。为了让后续阶段的提示词自动包含正确的项目路径，使用了**事件驱动的自动追踪**：

```typescript
// 应用启动时注册一次
api.onArtifactChanged((event) => {
  recordArtifactTouch(event.spaceId, event.relativePath)
})

// 每次文件变更时
recordArtifactTouch(spaceId, relativePath) {
  // 提取顶级目录名，如 "my-service/src/handler.go" → "my-service"
  const segment = relativePath.split(/[/\\]/).filter(Boolean)[0]
  // 幂等写入，已有则跳过（不触发 Zustand 更新）
  if (prev.includes(segment)) return t
  return { ...t, touchedProjectDirs: [...prev, segment] }
}
```

这样无需用户手动维护项目列表，AI 改了哪些项目就自动记录哪些，`getInvolvedProjectDirNames()` 将手动添加的 `projectDirs` 和自动记录的 `touchedProjectDirs` 合并去重后注入提示词。

### 9.4 流式响应文本连续性处理

在 `stream-processor.ts` 中，有一个精妙的设计解决了工具调用打断文本流的问题：

```
AI 生成流程（简化）：
  "我来分析一下..." [text block]
  → call Glob("/src")   [tool block - 非实质性]
  → "目录结构如下：..."  [text block] ← 追加到前文
  → call Read("main.go") [tool block - 非实质性]
  → "主要逻辑在..."      [text block] ← 追加到前文

  vs.

  → call Bash("make build") [tool block - 实质性]
  → "编译成功，接下来..." [text block] ← 替换前文（前文是过渡性描述）
```

通过 `hadSubstantiveToolSinceLastText` 标志位，在实质性工具（除 `TodoWrite` 之外的所有工具）调用后，下一段文本会**替换**而非追加上一段，避免"正在执行X操作…"这类过渡句混入最终展示内容。

### 9.5 Session Report Card

每次"开始工作"完成后自动展示本次 AI 会话的统计报告。通过订阅 `useChatStore` 的 `isGenerating` 状态变化：

- `false → true`：记录开始时间 `reportStartTimeRef.current = Date.now()`
- `true → false`：读取最后一条消息的 `tokenUsage` + `metadata.fileChanges`，计算耗时

Tab 4/5 还额外展示**文件改动统计**（增删行数、涉及文件数），数据由主进程在 stream 处理中提取后挂载到消息 metadata 上。

### 9.6 多项目 Sub-agent 并行处理

当 Tab 4 涉及多个项目路径时，提示词引导 AI 利用 **Task 工具**派发并行子 Agent，每个子 Agent 负责一个项目：

```
单项目任务：AI 直接修改代码
多项目任务：
  主 Agent
    ├── Task(subagent_type="Bash") → 子 Agent A（项目路径 1）
    ├── Task(subagent_type="Bash") → 子 Agent B（项目路径 2）
    └── ...
  等待所有子 Agent 完成 → 汇总报告
```

每个子 Agent 的 prompt 由主 Agent 自行构建，包含：该项目的完整路径、完整开发计划、分支名、相关子任务上下文，并约束只在对应项目范围内修改。`Task` 工具已加入 `DEFAULT_ALLOWED_TOOLS`，无需用户额外授权。

### 9.7 任务-会话双向绑定

任务列表（左侧）与会话面板（右侧）保持实时联动：

**任务切换 → 会话跟随**：`SpacePage` 通过 `useEffect([activeTaskId, currentSpace?.id])` 监听活跃任务变化，当任务属于当前空间且目标会话存在时，自动调用 `selectConversation()` 切换会话，无需用户手动切换。

**会话草稿独立保存**：`ChatView` 维护一个 `Map<conversationId, draft>` ref，输入框通过 `key={conversationId}` 在切换时强制重挂，新会话挂载时读取对应草稿作为初始值；文字变化时回写 Map。草稿只存在内存中，随应用重启清空。

---

## 10. Claude Agent SDK 集成

### 10.1 核心 API

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

const session = await unstable_v2_createSession({
  model,
  cwd,                          // AI 的工作目录
  systemPrompt,                 // 自定义 system prompt（非 SDK 默认）
  maxTurns: 50,                 // 最大 agentic 轮次
  allowedTools,                 // 允许的工具列表
  permissionMode: 'bypassPermissions',  // 跳过权限弹窗
  canUseTool: (tool) => ...,    // 细粒度工具权限回调
  mcpServers: [...],            // 注入 MCP 服务
  includePartialMessages: true, // 启用流式 token 事件（自定义 patch）
  resume: savedSessionId,       // 恢复历史会话（自定义 patch）
})
```

### 10.2 Session 复用 — 进程级复用

SDK 每个 Session 对应一个 Claude Code 子进程。DevX 实现了**进程复用**：同一会话的多次消息复用同一个子进程，节省约 3-5 秒的冷启动时间：

```
第一次发送消息 → 启动 Claude Code 进程 → 建立 Session
第二次发送消息 → 复用已有进程 → 直接发送（无冷启动）
会话切换       → 旧进程保留一段时间后回收
```

### 10.3 Sub-agent 支持

通过 `AgentDefinition` API 注册预定义子 Agent，AI 可以通过 `Task(subagent_type="web-searcher")` 派发独立子进程执行特定任务：

```typescript
const WEB_SEARCHER_AGENT: AgentDefinition = {
  description: 'Search the web for information',
  tools: ['ai-browser', 'web-search'],
  prompt: '...',
  model: 'sonnet',
}
```

子 Agent 在隔离进程中运行，有独立的工具权限和系统提示，结果回传主 Agent。

### 10.4 SDK Patch 扩展

项目对 SDK 打了自定义 patch（`patches/@anthropic-ai+claude-agent-sdk+0.1.76.patch`），扩展了以下能力：

| 扩展点 | 用途 |
|--------|------|
| `resume` 参数 | 从磁盘恢复历史会话，保持 AI 上下文 |
| `stream_event` 流式事件 | token 级别实时流式输出（支持思考块） |
| `session.pid` | 获取子进程 PID，用于进程管理和强制终止 |
| `transport.onExit()` | 子进程退出回调，用于资源清理 |
| `transport.isReady()` | 检测子进程是否就绪，优化首次发送时机 |
| `session.query.supportedCommands()` | 获取可用的 slash 命令列表 |

### 10.5 MCP 服务注入

每个 Session 创建时自动挂载以下 MCP 服务：

| MCP 服务 | 功能 | 挂载条件 |
|---------|------|---------|
| `ai-browser` | 浏览器自动化（Playwright） | 用户开启 AI Browser 时 |
| `halo-apps` | Digital Human 自动化应用管理 | 始终挂载 |
| `web-search` | 网页搜索（Bing/Baidu） | 始终挂载 |
| 用户自定义 MCP | 数据库等外部工具 | 用户配置后挂载 |

### 10.6 凭证路由层

所有 AI 服务商的凭证（Anthropic API Key、GitHub Copilot Token、自定义 OpenAI 兼容 API 等）统一通过本地 `openai-compat-router` 中转：

```
SDK → localhost:PORT (openai-compat-router)
            ↓
    按服务商路由 →  Anthropic API
                 →  GitHub Copilot Token
                 →  自定义 API Endpoint
```

这使得 SDK 层无需感知多服务商差异，也方便实现请求拦截、日志记录和流量控制。

---

## 11. 知识库集成

### 两种接入模式

```
任务绑定了知识库空间？
  ↓ 是
  knowledgeBaseRoot（文件系统路径）可用？
    ↓ 是 → 提示词指令 AI 用 Glob/Read 工具主动浏览，可读写
    ↓ 否 → 预加载最多 28 个 .md 文件（总上限 48k 字符）注入提示词
```

| 模式 | 优势 | 限制 |
|------|------|------|
| 主动浏览（root path） | AI 可自主寻找引导文档、写入新知识 | 需 AI 工具访问本地文件系统 |
| 预加载注入（markdown） | 无工具依赖，稳定 | 只读，内容有截断上限 |

### KB 引导文档约定

各阶段 AI 会按关键词自动查找对应引导文档：

| 阶段 | 查找关键词 |
|------|---------|
| 需求识别 | `需求识别` / `requirement` / `guide` |
| 任务拆解 | `任务拆解` / `task-breakdown` / `breakdown` |
| 开发计划 | `开发计划` / `dev-plan` / `planning` |
| 编码实现 | `编码` / `coding` / `implementation` |
| 用例验证 | `验证` / `verification` / `test` |

---

## 12. 数据持久化

### Workspace Tasks

- **机制**：Zustand `persist` → Electron `localStorage`
- **Key**：`devx-workspace-tasks-v1`
- **位置**：`~/Library/Application Support/DevX/Local Storage/leveldb/`
- **注意**：`activeTaskId` 等会话状态不持久化

### Pipeline Tasks（独立流水线系统）

- **机制**：SQLite（`better-sqlite3`）
- **位置**：
  - 生产：`~/.devx/devx.db`
  - 开发：`~/.devx-dev/devx.db`
  - 自定义：`$DEVX_DATA_DIR/devx.db`

```bash
# 查看任务列表
sqlite3 ~/.devx-dev/devx.db \
  "SELECT id, title, stage FROM pipeline_tasks ORDER BY created_at DESC LIMIT 10;"

# 查看子任务
sqlite3 ~/.devx-dev/devx.db \
  "SELECT task_id, title, status FROM pipeline_subtasks;"
```

==================

发现了几个实质性问题，按优先级整理：

---

### 问题 1（最严重）：`web-searcher` Agent 是死代码

`agents.ts` 定义了 `PREDEFINED_AGENTS`，注释里说 "passed to the SDK via `Options.agents`"，但实际上**从未传给 SDK**：

- `sdk-config.ts` 的 `buildBaseSdkOptions` 没有 `agents` 字段
- `session-manager.ts` warmup 时硬编码了 `agents: []`
- 全代码库没有任何地方 import `PREDEFINED_AGENTS`

结果：AI 根本无法调用 `Task(subagent_type="web-searcher")`，这个 agent 完全不生效。

---

### 问题 2：两版 system prompt 对 Task 的描述不一致

| | OFFICIAL | HALO（默认） |
|---|---|---|
| Task 使用强度 | `CRITICAL` / `VERY IMPORTANT`，强制 | `Consider`，建议性 |
| 提及 specialized agents | 有（"proactively use the Task tool with specialized agents"） | 无 |
| AI Browser Task 示例 | 无 | 有 |

HALO 版本删除了两条强指令，但既然 web-searcher 实际上没有注册，这个差异目前没有实际影响。如果问题 1 修复后，HALO 版本也需要补上 specialized agents 的引导。

---

### 问题 3：`canUseTool` 对 Task 完全透明

除 `AskUserQuestion` 外所有工具直接放行，Task 工具启动子进程没有任何日志记录或审计，出了问题难以追踪。这是设计取舍，不一定要改，但值得知晓。

---

### 问题 4：多项目并行块已注释（已知，刚才做的）

`buildCodingKickoffMessage` 里的多项目 Task 并行指引已注释掉，目前不生效。

---

### 总结

| 问题 | 严重程度 | 原因 |
|---|---|---|
| `PREDEFINED_AGENTS` 从未传给 SDK，web-searcher 不生效 | 高 | `sdk-config.ts` 漏掉了 `agents` 字段 |
| 两版 system prompt Task 描述不一致 | 低 | HALO 版本精简时移除了部分指引 |
| Task 工具调用无日志 | 低 | 设计取舍 |
| 多项目并行块注释 | 已知 | 主动注释 |

最值得修的是**问题 1**——在 `buildBaseSdkOptions` 里补上 `agents: PREDEFINED_AGENTS`，web-searcher 就能真正工作了。要动手吗？

------------
本次共改动了 3 个文件：

---

### 1. `sdk-config.ts` — 修复 PREDEFINED_AGENTS 死代码

`agents.ts` 里定义的 `web-searcher` agent 从未传给 SDK，导致 `Task(subagent_type="web-searcher")` 实际上不可用。

**改动：** 在 `buildBaseSdkOptions` 里加入：
```typescript
import { PREDEFINED_AGENTS } from './agents'
// ...
agents: PREDEFINED_AGENTS,
```

---

### 2. `system-prompt.ts` — HALO prompt 补充 web-searcher 使用指引

HALO 的 `# Web Research` 章节原本只有 2 条，agent 不知道可以用 `web-searcher` 做深度网页调研。

**改动：** 新增第 3 条：
```
- For deeper web research (e.g. looking up library docs, API references, error solutions during coding tasks), use Task(subagent_type="web-searcher") to search via AI Browser in an isolated sub-process — this keeps the main context clean.
```

---

### 3. `workspace-task-messages.ts` — 任务流水线 Tab 1/2/3 引入 Task/Explore

原来 Tab 3 的项目探索直接用 Glob（全量 tool result 进主上下文），Tab 1/2 没有项目探索。

**改动原则：** broad survey → Task/Explore（隔离子进程，不污染主上下文）；targeted lookup → Glob/Grep/Read 直接用

| 位置 | 改动内容 |
|------|---------|
| Tab 1 意图（有 KB） | 新增步骤 4/5：查找项目技术知识文档，不存在则 Task/Explore 探索并写入 KB |
| Tab 2 意图（有 KB） | 同上 |
| Tab 2 执行（有 KB） | 同上 |
| Tab 3 意图（有 KB，step 4a） | `使用 Glob` → `使用 Task 工具（subagent_type="Explore"）` |
| Tab 3 执行（有 KB，step 4a） | 同上 |
| Tab 3 执行（无 KB） | 原来 3 行 Glob 探索 → 3 步：Task/Explore 宏观探索 + 按需 Glob/Grep/Read 精确查询 + 基于实际结构制定计划 |

Tab 4 保持不变（编码阶段需要精确文件定位，直接 Glob/Grep）。