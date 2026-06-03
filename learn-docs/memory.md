# Claude Code 记忆系统源码分析

> 源码路径: `claude-code-source/src/`
> 分析日期: 2026-05-09

---

## 概述

Claude Code 共有 **5 个重叠的记忆系统** + **2 个后台维护服务**。每个系统服务于不同的生命周期和用途。

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    Claude Code 记忆系统整体架构                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    持久存储层 (Memdir)                              │    │
│  │  ~/.claude/projects/<repo>/memory/                                  │    │
│  │  ┌─────────────┬──────────────┬──────────────┬──────────────┐     │    │
│  │  │  MEMORY.md  │              │              │              │     │    │
│  │  │   (索引)    │   user/      │  feedback/   │  project/    │     │    │
│  │  │  ≤200行     │  用户画像    │  行为指导    │  项目上下文  │     │    │
│  │  │  ≤25KB      │              │              │              │     │    │
│  │  └──────┬──────┴──────┬──────┴──────┬───────┴──────┬───────┘     │    │
│  │         │             │             │              │              │    │
│  │         └─────────────┴─────────────┴──────────────┘              │    │
│  │                  reference/ (外部指针)                              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     记忆系统 (5个)                                  │    │
│  │                                                                    │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────┐  │    │
│  │  │ Auto     │  │ Session  │  │ Team     │  │ Agent   │  │KAIROS│  │    │
│  │  │ Memory   │  │ Memory   │  │ Memory   │  │ Memory  │  │Daily │  │    │
│  │  │ (Memdir) │  │ (会话级) │  │ (团队)   │  │ (子agent)│  │ Log  │  │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  └──┬──┘  │    │
│  │       │             │             │             │          │      │    │
│  │       └─────────────┴─────────────┴─────────────┴──────────┘      │    │
│  │                         共享四类型分类法 + MEMORY.md 格式           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     后台维护服务 (2个)                               │    │
│  │                                                                    │    │
│  │  ┌──────────────────────────┐  ┌──────────────────────────────┐   │    │
│  │  │  Extract Memories        │  │  AutoDream                   │   │    │
│  │  │  每轮完整 query 循环结束 │  │  夜间整理                    │   │    │
│  │  │  后台 forked agent       │  │  三闸门: ≥24h + ≥5会话 + 锁  │   │    │
│  │  │  增量提取新消息 → 写记忆 │  │  综合 daily logs → 合成 topic│   │    │
│  │  │  游标追踪 + mtime 互斥   │  │  仅 KAIROS 模式: /dream 技能 │   │    │
│  │  └──────────────────────────┘  └──────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     读写时机                                        │    │
│  │                                                                    │    │
│  │  写入: 主agent(随时) → Extract Memories(每轮) → AutoDream(每天)   │    │
│  │              ↑ 实时写入           ↑ 增量提取         ↑ 综合整理     │    │
│  │  读取: system prompt(会话开始) → Relevance Recall(按需)            │    │
│  │              ↑ 全部索引注入         ↑ Sonnet 精挑 ≤5 条            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 一、四类型分类法 (memoryTypes.ts)

位于 `src/memdir/memoryTypes.ts`，是整个记忆系统的分类基础。四种类型由 `MEMORY_TYPES` 常量定义：

```typescript
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]
```

每种类型在 **两个版本**（`TYPES_SECTION_COMBINED` / `TYPES_SECTION_INDIVIDUAL`）中以 **XML 格式**定义教学文本，这两个字符串数组被直接 join 后注入 AI 的 system prompt。代码中**不解析这些 XML**，它们是写给 AI 读的纯指令。

除了 `<name>`、`<scope>`、`<description>`、`<examples>` 等基础元素外，还有三个关键教学字段：

| XML 元素 | 用途 | 出现范围 |
|----------|------|---------|
| `<when_to_save>` | 教导 AI **什么时机**应该保存此类记忆 | 所有 4 种类型 |
| `<how_to_use>` | 教导 AI **如何使用**已读取的记忆 | 所有 4 种类型 |
| `<body_structure>` | 教导 AI 保存时笔记正文应遵循什么结构 | 仅 feedback + project |

*注意：`<body_structure>` 仅出现在 feedback 和 project 类型中，user 和 reference 没有此元素。*

这些教学块被注入到 **3 个位置**：

| 注入位置 | 文件 | 用途 |
|----------|------|------|
| 主 agent system prompt | `memdir.ts` | 指导主 agent 在对话中识别并保存记忆 |
| 团队记忆 prompt | `teamMemPrompts.ts` | 个人+团队组合模式下的统一指令 |
| 提取子 agent prompt | `extractMemories/prompts.ts` | 后台 forked agent 遵守相同分类规则 |

### user — 用户画像

**提示词原文**（`TYPES_SECTION_INDIVIDUAL` 中）：

```xml
<type>
    <name>user</name>
    <scope>always private</scope>
    <description>Facts about the user — their role, preferences, responsibilities, and knowledge background.</description>
    <when_to_save>When you learn any detail about the user's role, preferences, responsibilities, or knowledge background. These paint a picture of who the user is — helpful for calibrating responses.</when_to_save>
    <how_to_use>When the work involves considering the user's background, role, or preferences. For example, use knowledge of the user's deep experience to skip basic explanations.</how_to_use>
    <examples>
User: "I'm a data scientist investigating what logging we have in place"
→ type: user | name: data-scientist-investigating-observability | description: User is a data scientist currently focused on observability/logging. They may need help tracing data flows, understanding existing instrumentation, or adding new logging.
    </examples>
</type>
```

### feedback — 行为指导

**提示词原文**：

```xml
<type>
    <name>feedback</name>
    <scope>default to private. Save as team only when the guidance is clearly a team-wide standard (testing strategy, build conventions).</scope>
    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing.</description>
    <when_to_save>Any time the user corrects your approach ("no not that", "don't", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. In both cases, save what is applicable to future conversations, especially if surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so that the user and other users in the project do not need to offer the same guidance twice.</how_to_use>
    <body_structure>Lead with the rule itself, then a **Why:** line (the reason the user gave — often a past incident or strong preference) and a **How to apply:** line (when/where this guidance kicks in). Knowing *why* lets you judge edge cases instead of blindly following the rule.</body_structure>
    <examples>...</examples>
</type>
```

**关键原则**：失败和成功都要记录。只记纠正会变得畏缩，只记成功会忘记教训。

### project — 项目上下文

| XML 元素 | 教学指令（中文概要） |
|----------|-------------------|
| `<when_to_save>` | 学到谁在做什么、为什么、什么时候截止。状态变化快，需及时更新。**始终将相对时间转为绝对日期**（如 "周四" → "2026-03-05"） |
| `<how_to_use>` | 理解用户请求背后的细节和动机，预判跨用户协调问题，做出更明智的建议 |
| `<body_structure>` | 事实/决策 → **Why:**（约束、截止日期、需求来源）→ **How to apply:**（如何影响建议）。项目记忆衰减快，why 帮助判断是否仍然有效 |

### reference — 外部指针

| XML 元素 | 教学指令（中文概要） |
|----------|-------------------|
| `<when_to_save>` | 学到外部系统中的资源和用途时，如 bug 在 Linear 的哪个 project、反馈在 Slack 的哪个 channel |
| `<how_to_use>` | 当用户引用外部系统或可能需要外部信息时 |
| note | reference 没有 `<body_structure>` 元素。示例：user 说 "the Grafana board at grafana.internal/d/api-latency is what oncall watches" → 保存为 reference memory: oncall 延迟面板，编辑请求路径代码时检查 |
### 记忆教学体系总览

除了类型定义，`memoryTypes.ts` 还包含以下教学模块，每个模块都会注入 system prompt：

- **What NOT to save** — 6 类不保存内容：代码模式、git 历史、调试方案、CLAUDE.md 已有内容、临时任务状态。**即使用户要求保存 PR 列表或活动摘要，也要问"有什么出乎意料或非显而易见的？"**
- **When to access** — 三个时机：感觉相关时、用户要求回忆时（必须）、用户说"忽略记忆"时（当作 MEMORY.md 为空）
- **Before recommending from memory** — 记忆是"当时的快照"，推荐前需验证文件/函数是否存在。如果记忆与当前状态冲突，信任当前状态并更新/删除记忆
- **Memory drift caveat** — 记忆会过时。在基于记忆回答前，验证记忆仍然正确且最新

---

## 二、持久存储层 — Memdir

**路径**: `src/memdir/` (7 个文件)

Memdir 是整个记忆系统的物理存储层，定义了记忆文件的目录结构、索引格式、容量保护和路径解析规则。

### 目录结构

```
~/.claude/projects/<sanitized-git-root>/memory/
  MEMORY.md          ← 索引文件（≤200 行 / ≤25KB）
  user/              ← 用户画像（角色、偏好、知识背景）
  feedback/          ← 用户给出的行为指导（肯定/纠正）
  project/           ← 项目上下文（目标、Bug、deadline）
  reference/         ← 外部系统指针（Dashboard URL、Linear 项目）
```

### 关键文件职责

| 文件 | 职责 |
|------|------|
| `memdir.ts` | 核心调度：定义 MEMORY.md 容量限制、构建 memory prompt、`loadMemoryPrompt()` 统一入口 |
| `memoryTypes.ts` | 四类型分类法定义 + 给 AI 的教学文本（类型说明、保存规则、示例） |
| `memoryScan.ts` | 扫描记忆目录中所有 `.md` 文件，读取 frontmatter，按 mtime 排序 |
| `paths.ts` | 路径解析（env var > settings.json > 默认路径），安全校验 |
| `findRelevantMemories.ts` | 调用 Sonnet side-query，从记忆列表中选择最多 5 条最相关的 |

### 容量保护 (`memdir.ts:34-38`)

```typescript
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
```

`truncateEntrypointContent()` 实施双重限幅：先行后字节，超限时追加 WARNING 行。

### 路径解析优先级 (`paths.ts:223-235`)

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 环境变量（Cowork 全路径覆盖）
2. `autoMemoryDirectory` 配置项（仅信任 policy/local/user 来源）
3. 默认: `~/.claude/projects/<sanitized-git-root>/memory/`

### 保存格式

每篇记忆文件使用 YAML frontmatter + Markdown 内容：

```markdown
---
name: {{记忆名称}}
description: {{一行描述 — 用于未来对话中判断相关性}}
type: user|feedback|project|reference
---

{{记忆内容 — feedback/project 类型建议: 规则/事实, 然后 **Why:** 和 **How to apply:**}}
```

---

## 三、5 个记忆系统

所有 5 个系统共享相同的四类型分类法和 MEMORY.md 格式，但服务于不同的生命周期和使用场景。

### 对比总览

| 系统 | 生命周期 | 存储位置 | 维护者 | 核心用途 |
|------|---------|---------|-------|---------|
| **Auto Memory (Memdir)** | 持久（跨会话） | `memory/` 目录 | 主 agent + Extract + AutoDream | 核心持久记忆，四类型分类 |
| **KAIROS Daily Log** | 持久（append-only） | `memory/logs/` | 主 agent（append）→ `/dream`（整理） | 长期助理模式的流水日志 |
| **Session Memory** | 会话级 | `SessionMemory/` | 后台 forked agent | 当前会话关键信息的临时笔记 |
| **Team Memory** | 团队级 | `memory/team/` | 多用户共享，同步到服务器 | 团队协作的共享上下文 |
| **Agent Memory** | 子 agent 级 | 独立目录 | forked agent | 子 agent 内部记忆 |

### Auto Memory (Memdir)

最核心的记忆系统。主 agent 在对话中自主判断值得记忆的信息，按四类型分类写入 topic 文件，两步保存（Write 文件 → Edit MEMORY.md 索引）。

- **写入**: 主 agent 自主（随时）+ Extract Memories 后台提取（每轮）
- **读取**: 通过 `loadMemoryPrompt()` 在每个会话开始时注入 MEMORY.md 索引
- **容量**: MEMORY.md ≤200 行 / ≤25KB，超限自动截断

### KAIROS Daily Log

长期助理模式下的 append-only 日志系统，替代直接操作 MEMORY.md：

- 主 agent 将每次会话的关键信息**追加**到 `logs/YYYY/MM/YYYY-MM-DD.md`
- 不修改已有内容（append-only），夜间通过 `/dream` 技能合成为 topic 文件
- 记录内容：用户纠正、偏好、项目上下文、外部指针（+ WHAT_NOT_TO_SAVE）

### Session Memory

会话级临时记忆，不是持久存储：

- 每个会话一个独立 markdown 文件
- 后台 forked agent 通过 `registerPostSamplingHook` 每 N 次 tool call 后更新
- 不写入持久 MEMORY.md，会话结束后丢弃

### Team Memory

团队共享记忆，支持多用户协作：

- 存放在 `memory/team/` 子目录
- 同步到 Anthropic 服务器实现共享
- 使用 ETag 锁 + 增量上传（delta uploads）
- 内容通过 SHA-256 哈希 + 密钥扫描确保安全

### Agent Memory

子 agent（forked agents）的独立记忆：

- 3 种作用域: `user` / `project` / `local`
- 和 Auto Memory 共享相同的四类型分类法和 MEMORY.md 格式
- 每个 forked agent 有自己独立的记忆实例

---

## 四、2 个后台维护服务

这两个服务运行在对话流程之外，以 forked agent 模式在后台自动维护记忆系统。

| 服务 | 触发时机 | 工作方式 | 主要职责 |
|------|---------|---------|---------|
| **Extract Memories** | 每轮完整 query 循环结束 | fire-and-forget forked agent | 从对话中增量提取新记忆并写入 |
| **AutoDream** | 夜间（≥24h + ≥5 新会话） | fire-and-forget forked agent | 综合 daily logs 合成新 topic |

### Extract Memories — 后台提取服务

**路径**: `src/services/extractMemories/` (2 个文件)

```
每轮完整 query 循环结束
    ↓ (handleStopHooks)
判断是否需要提取
    ↓
fork 一个子 agent（完美克隆当前会话，共享 prompt cache）
    ↓
子 agent 读取会话转录 + 现有记忆索引
    ↓
自主判断哪些信息值得持久化
    ↓
使用原生 Write/Edit 工具写入记忆文件 + 更新 MEMORY.md
```

关键机制：

| 机制 | 说明 |
|------|------|
| **游标追踪** | 记录上次提取到的 message UUID，增量处理 |
| **互斥锁** | 主 agent 已写的记忆（通过文件 mtime 检测），子 agent 跳过 |
| **权限限制** | 子 agent 仅 Read/Write/Edit/Glob/Grep/Bash，无网络危险工具 |
| **触发条件** | `isExtractModeActive()` — feature gate + 非交互模式 |

### AutoDream — 夜间整理服务

**路径**: `src/services/autoDream/` (4 个文件)

三闸门机制：

```
每次 query 循环结束后检查
    ↓
1. 时间门：距上次整理 ≥24 小时？(autoDream.ts:63-66)
    ↓
2. 会话门：新会话 ≥5 个？
    ↓
3. 锁门：无其他进程在整理（文件锁）
    ↓
全部通过 → fork 子 agent 执行 consolidation
    ↓
综合 daily logs + 会话转录 + 现有记忆
    ↓
生成新的 topic 文件 + 更新 MEMORY.md
```

| 文件 | 职责 |
|------|------|
| `autoDream.ts` | 核心调度逻辑 |
| `config.ts` | feature gate |
| `consolidationLock.ts` | 文件锁机制（防止并发） |
| `consolidationPrompt.ts` | "梦境"提示词 — 引导 AI 综合来源合成记忆 |

KAIROS 模式下，AutoDream 被替换为磁盘技能 `/dream`：主 agent 使用 append-only daily log，夜间 `/dream` 将日志合成为 topic 文件 + MEMORY.md。

---

## 五、读写时机与完整数据流

读写时机是架构图的顶层，覆盖了记忆系统的全部访问模式。写入端有 3 类写入者（主 agent 实时写入、Extract Memories 每轮提取、AutoDream 每日整理），读取端有 4 个查询时机（会话启动注入、相关性召回、按需读取、后台读取）。

### 5.1 写入时机

Claude Code 的记忆写入有 **4 种写入者**，分别在**不同时机**触发。

### 写入角色对比

| 写入者 | 文件 | 时机 | 写入方式 | 容量影响 |
|--------|------|------|---------|---------|
| **主 agent** | conversation-level | 对话中的**任何时刻** | 自主判断，Write/Edit 直接操作文件 | 直接写入 topic 文件 |
| **Extract Memories** | `extractMemories.ts` | 每轮 **完整 query 循环结束** | 后台 forked agent 增量提取 | 写入独立 topic 文件，更新索引 |
| **AutoDream** | `autoDream.ts` | **夜间**（≥24h + ≥5 新会话） | 后台 forked agent 综合合成 | 合并 daily logs 生成新 topic |
| **Session Memory** | `SessionMemory/` | 每 N 次 **tool call 后** | 后台 forked agent 更新临时笔记 | 不写入持久存储 |

### 详细时机链

```
用户发送消息 → 主 agent 处理
                              ↓
              主 agent 自主判断 → 是否有值得记忆的信息？
                               ├── 是 → Write/Edit 记忆文件 + 更新 MEMORY.md
                               └── 否 → 继续对话
                              ↓
              主 agent 产生最终响应（无 tool call）
                              ↓
              ┌─ handleStopHooks ──────────────────────┐
              │                                         │
              │  Extract Memories (fire-and-forget)     │
              │  1. 获取上次提取后的新消息              │
              │  2. 如果消息数 < 阈值 → 跳过            │
              │  3. 扫描现有记忆（去重）                │
              │  4. fork 子 agent                       │
              │  5. 子 agent 分析消息 + 写新记忆        │
              │  6. 更新游标 (message UUID)             │
              │                                         │
              │  AutoDream (门闸检查)                   │
              │  1. 时间门：距上次 ≥24h？              │
              │  2. 会话门：新会话 ≥5 个？             │
              │  3. 锁门：无其他进程在整理？           │
              │  全部通过 → fork 子 agent               │
              │  → 综合 daily logs + 会话 → 合成新 topic│
              └─────────────────────────────────────────┘
```

### 主 agent 写入细节

主 agent 在对话中被教导了两步保存流程：

```
Step 1: Write 一个新 `.md` 文件到对应类型的子目录
Step 2: Edit MEMORY.md，追加索引行 `- [name](type/file.md) -- description`
```

AI 被要求**主动判断**何时保存：包括显式纠正、隐式确认、非显而易见的项目信息、外部工具指针。同时被警告不要保存临时状态、代码模式、git 历史等可推导信息。

### Extract Memories 写入细节

- **增量机制**：closure-scoped `lastExtractedMessageUuid`，只处理上次提取后的新消息（`getModelVisibleMessagesSince`）
- **互斥保护**：子 agent 通过 mtime 检测主 agent 已写的记忆文件，自动跳过
- **最小消息阈值**：`MIN_MESSAGES_FOR_EXTRACTION` — 消息太少则不提取
- **权限锁定**：子 agent 仅 6 个安全工具（Read/Write/Edit/Glob/Grep/Bash），无网络工具
- **触发条件**：`isExtractModeActive()` → feature gate + 非交互模式

### AutoDream 写入细节

- **三闸门机制**：时间（24h）+ 会话（5 个）+ 锁（文件锁），三者缺一不可
- **KAIROS 模式替代**：长期助理模式下，主 agent 使用 append-only daily log，夜间通过 `/dream` 技能（磁盘技能，非自动触发）合成为 topic 文件
- **多源综合**：子 agent 同时读取 daily logs + 会话转录 + 现有记忆，自主合成新 topic

### 5.2 查询时机

Claude Code 在 **4 个时机**读取记忆，每个时机读取的内容和方式不同。

### 查询角色对比

| 查询者 | 时机 | 读取内容 | 读取方式 |
|--------|------|---------|---------|
| **主 agent** | 新会话开始时 | MEMORY.md 索引 + 类型指令 | `loadMemoryPrompt()` 注入 system prompt |
| **主 agent** | 对话中按需 | 具体记忆文件 | 自主 Read 文件 |
| **Relevance Recall** | 主 agent 处理查询时 | ≤5 条最相关记忆 | Sonnet side-query |
| **Extract Memories** | 后台提取时 | 现有记忆索引 | 扫描目录 → 去重 |
| **AutoDream** | 夜间整理时 | 全部 daily logs + 会话转录 | 子 agent 批量读取 |

### 1. 会话启动注入 — `loadMemoryPrompt()`

```
systemPromptSection('memory', () => loadMemoryPrompt())
```

- **每个会话只构建一次**，结果被缓存
- `loadMemoryPrompt()` 根据 feature gate 三路分流：
  - KAIROS → daily-log 指令（append-only，不直接操作 MEMORY.md）
  - TEAMMEM → 个人+团队组合指令
  - 纯 auto → 个人记忆指令
- 注入内容包含：
  1. 四类型分类法说明（XML 教学格式）
  2. 保存格式（frontmatter 模板）
  3. 两步保存流程（写文件 → 更新索引）
  4. 不该保存的内容列表
  5. 何时读取记忆
  6. 记忆漂移警告

### 2. 相关性召回 — `findRelevantMemories()`

`findRelevantMemories.ts` 提供了**选择性注入**机制：

```
接收查询 → 扫描所有记忆文件 → 过滤已展露的
    → 格式化为 "name — description" 列表
    → Sonnet side-query 选 ≤5 条
    → 返回 { path, mtimeMs }[]
```

- **选择标准**："clearly be useful" — 严格高门槛，不确信就不选
- **`recentTools` 过滤**：主动排除 AI 正在使用的工具的参考文档（降低 keyword 误匹配）
- **`alreadySurfaced` 过滤**：同一会话中已展露过的文件不再重复选择
- **空选择处理**：即使选 0 条也会记录 telemetry（区分"运行后 0 条"和"从未运行"）

### 3. 主 agent 按需读取

AI 在 system prompt 中被教导通过 `Read("type/filename.md")` 自主读取具体记忆文件。这发生在：

- 用户的问题涉及之前讨论过的话题时
- 用户明确要求"回忆之前的内容"时
- 需要理解项目上下文时

### 4. 后台进程读取

- **Extract Memories**：扫描现有记忆文件 → 避免重复写入相同内容
- **AutoDream**：读取完整 daily logs + 会话历史 + 现有 MEMORY.md → 综合判断哪些值得合并为 topic 文件

### 5.3 端到端完整数据流

从用户输入到记忆持久化的端到端生命周期：

```
┌─────────────────────────────────────────────────────────┐
│                    用户发送消息                          │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 系统 prompt 构建（每个会话一次）              │
│                                                         │
│  loadMemoryPrompt()                                     │
│  ├── KAIROS?              → daily-log 指令             │
│  ├── TEAMMEM + enabled?   → 个人+团队组合指令          │
│  ├── auto enabled?        → 个人记忆指令 + MEMORY.md   │
│  └── 以上都不是            → null（无记忆）             │
│                                                         │
│  结果注入 system prompt 的 [memory] section             │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 2: 主 agent 处理                                 │
│                                                         │
│  (可选) findRelevantMemories()                          │
│    → Sonnet side-query 从记忆库中精挑 ≤5 条            │
│    → 注入当前用户消息的头部                              │
│                                                         │
│  主 agent 在对话中：                                     │
│  ├── 按需 Read 具体记忆文件                              │
│  ├── 比对记忆内容与当前状态 → 发现过时则更新             │
│  ├── 发现值得记忆的信息 → Write 新文件                   │
│  └── 写入后 → Edit MEMORY.md 追加索引行                  │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 3: Query 循环结束                                │
│                                                         │
│  handleStopHooks() 触发后台任务                          │
│                                                         │
│  ┌────── Extract Memories ──────────────────────────┐   │
│  │  游标 → 增量消息 → 扫描现有记忆 → fork 子 agent  │   │
│  │  → 新消息分析 → 写新记忆文件 + 更新 MEMORY.md    │   │
│  │  关键: 互斥 (mtime检测) + 权限 (6 工具) + 最小阈值│   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌────── AutoDream (门闸检查) ───────────────────────┐   │
│  │  时间门(≥24h) + 会话门(≥5) + 锁门(文件锁)         │   │
│  │  → fork 子 agent                                  │   │
│  │  → 综合 daily logs + 会话转录 + 现有记忆          │   │
│  │  → 合成新 topic 文件 + 更新 MEMORY.md             │   │
│  │  KAIROS 替代: 夜间 /dream 技能                    │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌────── Session Memory ─────────────────────────────┐   │
│  │  Post-sampling hook → 更新会话级临时笔记           │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 4: 响应返回用户 + 后台写入完成                   │
│                                                         │
│  - print.ts 确保 extract 的 pending promise 在          │
│    gracefulShutdownSync 之前排空 (drainPendingExtraction)│
│  - 游标更新为当前消息 UUID，下次只处理增量               │
└─────────────────────────────────────────────────────────┘
```

### 关键设计原则

1. **写优先于读**：记忆系统设计为"先写后读"，AI 在 system prompt 中被教导主动保存，而非被动等待提取
2. **分层时效**：主 agent（实时）→ Extract Memories（每轮）→ AutoDream（每天），逐层综合，信息质量逐步提升
3. **互不阻塞**：Extract Memories 和 AutoDream 都是 fire-and-forget，不阻塞主 agent 响应
4. **容量安全**：MEMORY.md 200 行 / 25KB 硬限制，超限时自动截断并追加 WARNING
5. **增量处理**：游标（message UUID）、文件锁（AutoDream）、mtime 检测（互斥）三重机制防止重复和冲突

---

## 六、Claude Code 核心源码节选

> 只收录最关键的代码片段，完整源码见 `claude-code-source/src/`

### 6.1 类型定义 — `memoryTypes.ts`

四种类型的定义是 `MEMORY_TYPES` 常量，每种类型在 system prompt 中以 XML 格式教学：

```typescript
// memoryTypes.ts:14-19 — 类型定义
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]
```

每种类型有 5 个教学字段，以 `feedback` 为例：

```typescript
// memoryTypes.ts:57-74 — feedback 类型的完整 XML 教学定义
'<type>',
'    <name>feedback</name>',
'    <scope>default to private.</scope>',
'    <description>Guidance the user has given you about how to approach work '
    '— both what to avoid and what to keep doing. ...</description>',
'    <when_to_save>Any time the user corrects your approach '
    '("no not that", "don\'t", "stop doing X") '
    'OR confirms a non-obvious approach worked '
    '("yes exactly", "perfect, keep doing that") ...</when_to_save>',
'    <how_to_use>Let these memories guide your behavior so that '
    'the user and other users in the project do not need '
    'to offer the same guidance twice.</how_to_use>',
'    <body_structure>Lead with the rule itself, then a **Why:** line '
    '(the reason the user gave) and a **How to apply:** line '
    '(when/where this guidance kicks in).</body_structure>',
'</type>',
```

### 6.2 容量保护 — `memdir.ts`

```typescript
// memdir.ts:34-38 — 双重截断常量
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

// memdir.ts:57-93 — 截断函数（先截行，再截字节）
export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim()
  const contentLines = trimmed.split('\n')
  const lineCount = contentLines.length

  // Step 1: 行截断（取前 200 行）
  let truncated = contentLines
  let wasLineTruncated = false
  if (lineCount > MAX_ENTRYPOINT_LINES) {
    truncated = contentLines.slice(0, MAX_ENTRYPOINT_LINES)
    wasLineTruncated = true
  }

  // Step 2: 字节截断（在最后一个换行符处截断，不切在行中间）
  const joined = truncated.join('\n')
  let wasByteTruncated = false
  let content = joined
  if (Buffer.byteLength(joined, 'utf-8') > MAX_ENTRYPOINT_BYTES) {
    const truncatedBytes = Buffer.from(joined, 'utf-8')
      .subarray(0, MAX_ENTRYPOINT_BYTES)
    const lastNewline = truncatedBytes.lastIndexOf(10) // '\n'
    content = Buffer.from(truncatedBytes.subarray(0, lastNewline)).toString('utf-8')
    wasByteTruncated = true
  }

  // 追加 WARNING
  if (wasLineTruncated || wasByteTruncated) {
    const warnings: string[] = []
    if (wasLineTruncated) warnings.push(`Truncated to ${MAX_ENTRYPOINT_LINES} lines`)
    if (wasByteTruncated) warnings.push(`Truncated to ${MAX_ENTRYPOINT_BYTES} bytes`)
    content += `\n\n> [!WARNING] MEMORY.md was truncated: ${warnings.join('; ')}.\n`
  }

  return { content, lineCount, byteCount: Buffer.byteLength(content, 'utf-8'),
           wasLineTruncated, wasByteTruncated }
}
```

### 6.3 注入入口 — `memdir.ts`

`loadMemoryPrompt()` 是整个记忆系统的入口，根据 feature gate 分流三个模式：

```typescript
// memdir.ts:419-507 — 统一注入入口
export async function loadMemoryPrompt(): Promise<string | null> {
  const autoEnabled = isAutoMemoryEnabled()

  // 1. KAIROS 模式（长期助理）→ daily-log append-only
  if (feature('KAIROS') && autoEnabled && getKairosActive()) {
    return buildAssistantDailyLogPrompt(skipIndex)
  }

  // 2. TEAMMEM 模式 → 个人+团队组合指令
  if (feature('TEAMMEM') && teamMemPaths!.isTeamMemoryEnabled()) {
    return teamMemPrompts!.buildCombinedMemoryPrompt(extraGuidelines, skipIndex)
  }

  // 3. 普通模式 → 个人记忆指令
  if (autoEnabled) {
    return buildMemoryLines('auto memory', autoDir, extraGuidelines, skipIndex).join('\n')
  }

  return null
}
```

`buildMemoryPrompt()` 负责读取 MEMORY.md 并构建注入内容：

```typescript
// memdir.ts:272-316 — 构建 memory prompt
export function buildMemoryPrompt(params: {
  displayName: string
  memoryDir: string
  extraGuidelines?: string[]
}): string {
  const { displayName, memoryDir, extraGuidelines } = params

  // 同步读取 MEMORY.md
  let entrypointContent = ''
  try {
    entrypointContent = fs.readFileSync(entrypoint, { encoding: 'utf-8' })
  } catch { /* 尚无记忆文件 */ }

  const lines = buildMemoryLines(displayName, memoryDir, extraGuidelines)

  if (entrypointContent.trim()) {
    const t = truncateEntrypointContent(entrypointContent)
    lines.push(`## ${ENTRYPOINT_NAME}`, '', t.content)
  } else {
    lines.push(`## ${ENTRYPOINT_NAME}`, '',
      `Your ${ENTRYPOINT_NAME} is currently empty.`)
  }

  return lines.join('\n')
}
```

### 6.4 相关性召回 — `findRelevantMemories.ts`

Sonnet side-query 选择 ≤5 条相关记忆：

```typescript
// findRelevantMemories.ts:39-74 — 入口函数
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  recentTools: readonly string[] = [],
  alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
  // 扫描记忆文件，排除已经展露过的
  const memories = (await scanMemoryFiles(memoryDir, signal))
    .filter(m => !alreadySurfaced.has(m.filePath))
  if (memories.length === 0) return []

  // Sonnet 选相关记忆
  const selectedFilenames = await selectRelevantMemories(query, memories, signal, recentTools)
  const byFilename = new Map(memories.map(m => [m.filename, m]))
  const selected = selectedFilenames
    .map(filename => byFilename.get(filename))
    .filter((m): m is MemoryHeader => m !== undefined)

  return selected.map(m => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}

// findRelevantMemories.ts:77-141 — Side-query 选择器
async function selectRelevantMemories(
  query: string,
  memories: MemoryHeader[],
  signal: AbortSignal,
  recentTools: readonly string[],
): Promise<string[]> {
  const manifest = formatMemoryManifest(memories)  // "name — description" 列表

  const result = await sideQuery({
    model: getDefaultSonnetModel(),
    system: \`You are selecting memories that will be useful to Claude Code
as it processes a user's query. ... Return a list of filenames
for the memories that will clearly be useful (up to 5).
Be selective and discerning.\`,
    messages: [{ role: 'user', content: \`Query: \${query}\n\n\${manifest}\` }],
    max_tokens: 256,
    output_format: { type: 'json_schema', schema: { ... } },
    signal,
  })

  const parsed: { selected_memories: string[] } = jsonParse(textBlock.text)
  return parsed.selected_memories.filter(f => validFilenames.has(f))
}
```

### 6.5 Extract Memories 触发 — `stopHooks.ts`

每轮 query 循环结束后通过 `handleStopHooks` 触发：

```typescript
// stopHooks.ts:42-43 — 懒加载模块
const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? require('../services/extractMemories/extractMemories.js')
  : null

// stopHooks.ts:143-153 — 触发点（handleStopHooks 内部）
if (isExtractModeActive()) {
  // Fire-and-forget in both interactive and non-interactive.
  // print.ts drains the in-flight promise after flushing the response
  // but before gracefulShutdownSync (see drainPendingExtraction).
  void extractMemoriesModule!.executeExtractMemories(
    stopHookContext,
    toolUseContext.appendSystemMessage,
  )
}
```

### 6.6 Extract Memories 实现 — `extractMemories.ts`

Forked agent 模式，完美克隆当前会话：

```typescript
// extractMemories.ts:1-14 — 核心注释
/**
 * Extracts durable memories from the current session transcript
 * and writes them to the auto-memory directory.
 *
 * It runs once at the end of each complete query loop (when the model produces
 * a final response with no tool calls) via handleStopHooks in stopHooks.ts.
 *
 * Uses the forked agent pattern (runForkedAgent) — a perfect fork of the main
 * conversation that shares the parent's prompt cache.
 *
 * State is closure-scoped inside initExtractMemories() rather than module-level.
 * Tests call initExtractMemories() in beforeEach to get a fresh closure.
 */
```

游标追踪（closure-scoped）：记录最后一次处理的 message UUID，只处理增量：

```typescript
// extractMemories.ts — 游标追踪和增量处理的核心逻辑
export function initExtractMemories() {
  // closure-scoped: 每轮测试或初始化时都是新的
  let lastExtractedMessageUuid: string | undefined

  async function executeExtractMemories(
    stopHookContext: REPLHookContext,
    appendSystemMessage: (msg: SystemMessage) => void,
  ) {
    const messages = getModelVisibleMessagesSince(stopHookContext, lastExtractedMessageUuid)
    if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return

    const existing = await scanMemoryFiles(memoryDir, signal)
    const forked = await runForkedAgent({
      systemPrompt: buildExtractPrompt(existing),
      messages,
      // 只给有限工具，无网络危险工具
      tools: [Read, Write, Edit, Glob, Grep, Bash],
    })

    // 提取完成后记录 UUID
    lastExtractedMessageUuid = stopHookContext.lastAssistantMessageUuid
  }

  return { executeExtractMemories, isExtractModeActive, drainPendingExtraction }
}

// 权限限制：只给 6 个安全工具
const SAFE_TOOLS = [
  FILE_READ_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  BASH_TOOL_NAME,
]
```

### 6.7 KAIROS Daily Log 模式 — `memdir.ts`

```typescript
// memdir.ts:327-370 — assistant 模式的 daily-log 指令
function buildAssistantDailyLogPrompt(skipIndex = false): string {
  const logPathPattern = join(memoryDir, 'logs', 'YYYY', 'MM', 'YYYY-MM-DD.md')

  return [
    '# auto memory',
    \`You have a persistent, file-based memory system found at: \\\`\${memoryDir}\\\`\`,
    "This session is long-lived. As you work, record anything worth remembering",
    "by **appending** to today's daily log file:",
    \`\\\`\${logPathPattern}\\\`\`,
    '',
    'Write each entry as a short timestamped bullet. Create the file (and parent',
    'directories) on first write if it does not exist. Do not rewrite or reorganize',
    'the log — it is append-only. A separate nightly process distills these logs',
    'into \`MEMORY.md\` and topic files.',
    '',
    '## What to log',
    '- User corrections and preferences',
    '- Facts about the user, their role, or their goals',
    '- Project context not derivable from code',
    '- Pointers to external systems',
    ...WHAT_NOT_TO_SAVE_SECTION,
  ].join('\\n')
}
```
