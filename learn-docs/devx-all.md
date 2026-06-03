## 一、DevX Memory实现

### 7.1 五类型分类法

DevX 在 Claude Code 四类型基础上扩展为 **五类型**：

| 类型 | 作用域 | 用途 | 保存时机 |
|------|--------|------|----------|
| `user` | Global | 用户画像、偏好、背景 | 当了解用户是谁或他们喜欢什么时 |
| `feedback` | Space | 行为指导、纠正、确认的模式 | 当用户纠正或确认非显而易见的做法时 |
| `project` | Space | 架构决策、项目状态、"为什么"这么做 | 当了解决策原理或项目上下文时 |
| `reference` | Space | 外部系统指针（URL、工具、仪表盘） | 当发现与项目相关的外部资源时 |
| `knowledge` | Space | 领域知识、研究笔记、系统分析 | 当研究系统、分析代码、学习领域概念时 |

#### knowledge 类型设计思路

- **场景**: 用户正在学习源码、研究系统、分析架构 → 分析结论应持久化为知识
- **与 feedback 的区别**: feedback 是"以后遇到这种情况应该怎么做"的行为级指导；knowledge 是"这个系统的原理是 X"的事实级知识
- **存储**: `{spacePath}/.devx/memory/knowledge/`
- **提取规则**: 捕获所学内容的本质 — 原理、架构或权衡分析

### 7.2 存储布局

```
{spacePath}/.devx/memory/
  MEMORY.md              ← 索引文件（≤200 行 / ≤25KB）
  user/                  ← user 类型（全局作用域）
  feedback/              ← feedback 类型（空间作用域）
  project/               ← project 类型（空间作用域）
  reference/             ← reference 类型（空间作用域）
  knowledge/             ← knowledge 类型（空间作用域）
```

文件格式：YAML frontmatter + Markdown 内容

```markdown
---
name: kebab-case-unique-name
description: One-line hook for relevance matching
type: user|feedback|project|reference|knowledge
---

Full memory content...
```

### 7.3 相关性召回 (Relevance Recall)

**实现文件**: `classified.ts:369-528`

```
用户发送消息
    ↓
buildMemoryContext() / execute.ts
    ↓
scanClassifiedMemoryEntries() — 扫描所有类型目录
    ↓
如果条目数 ≤5 → 直接全部返回
    ↓
如果条目数 >5 → 调用 Sonnet side-query
    ↓
选中 ≤5 条最相关的 → 仅这些注入 context
```

#### 关键技术细节

| 维度 | 实现 |
|------|------|
| **入口** | `findRelevantClassifiedMemories(query, scope, apiKey, baseUrl, spacePath)` |
| **选择器模型** | `claude-sonnet-4-20250514` |
| **返回上限** | `MAX_RELEVANT_MEMORIES = 5` |
| **调用方式** | 直接 `@anthropic-ai/sdk` (execute.ts 中的 compaction 模式，无 V2 session 开销) |
| **Side-query prompt** | 要求模型阅读所有条目的 `name + description`，返回 JSON 数组 |
| **Fallback** | 无 credentials 或调用失败时 → 返回最近修改的前 N 条 |
| **解析** | 处理后可能的 ```json fences，只通过 `validNames` Set 校验 |

#### 集成点

**`send-message.ts` (交互聊天)**:
- `buildMemoryContext()` 函数中增加了 `query` / `apiKey` / `baseUrl` 参数
- 有 credentials 时 → 调用 `findRelevantClassifiedMemories()` 只注入相关条目
- 无 credentials → 动态 import 回退到 `buildClassifiedMemorySnapshot()` 全量注入

**`execute.ts` (自动化运行)**:
- 使用 trigger context + app name 拼接作为 query
- `buildFilteredClassifiedSnapshot()` 根据相关条目构建过滤后的 snapshot
- MCP server 注册保持不变（AI 仍可通过工具浏览完整记忆）

### 7.4 后台提取 (Extract Memories)

**实现文件**: `extract-memories.ts` (356 行，新建)

```
用户发送消息 → AI 回复完成
    ↓
send-message.ts 中 fire-and-forget 调用
    ↓
1. 冷却检查 (5分钟 cooldown / conversation)
    ↓
2. 扫描现有记忆 (重名检测)
    ↓
3. 构建 extraction prompt (会话转录 + 现有记忆索引)
    ↓
4. 调用 Sonnet 模型 (直接 API 调用)
    ↓
5. 解析 JSON 响应 {{save: [...], explain: "..."}}
    ↓
6. 写入文件 + 重建 MEMORY.md 索引
```

#### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **执行方式** | Fire-and-forget (`.then().catch()`) | 绝不阻塞用户响应 |
| **模型调用** | 直接 `@anthropic-ai/sdk` | 避免 V2 session 的 overhead |
| **去重** | 按 name 匹配已存在的条目 | 防止重复写入 |
| **冷却** | 每 conversation 5 分钟 | 避免频繁调用浪费 token |
| **对话裁剪** | `MAX_CONVERSATION_CHARS = 50_000` | 安全限幅，超出部分截断 |
| **重名策略** | 更新已有文件（不删除旧内容） | 积累而非替换 |
| **索引重建** | 每次写入后重建 | 保持 MEMORY.md 与磁盘一致 |

#### Extraction Prompt 设计要点

- **五类型说明**: 明确每种类型的 scope、用途、rules
- **防噪声规则**: "只保存令人惊讶的 / 非显而易见的 / 无法从代码推导的信息"
- **格式要求**: 返回 JSON `{ save: [{ type, name, description, content }], explain }`
- **内容指导**: feedback 类型要求包含 **Why** 和 **How to apply**；knowledge 类型要求包含原理 / 架构 / 权衡分析
- **排除项**: 不做代码模式、文件路径、git 历史、bug 修复步骤、临时状态

#### 集成点 (send-message.ts)

```typescript
// 在 processStream() + notifyTaskComplete() 之后
if (memorySpacePath && message.trim().length > 0) {
  const conv = getConversation(spaceId, conversationId)
  if (conv?.messages && conv.messages.length >= 2) {
    const extractMessages = conv.messages.map(m => ({
      role: m.role,
      content: m.content || '',
    }))
    extractMemories({
      messages: extractMessages,
      scope: 'space',
      spacePath: memorySpacePath,
      credentials,
      conversationId,
      signal: abortController.signal,
    }).then(result => {
      if (result.saved > 0 || result.updated > 0) {
        console.log(`[Agent][${conversationId}] Memory extraction: ${result.saved} saved, ${result.updated} updated`)
      }
    }).catch(err => {
      console.error(`[Agent][${conversationId}] Background memory extraction failed:`, err)
    })
  }
}
```

### 7.5 MCP 工具

`createClassifiedMemoryStatusMcpServer()` 为 AI 提供一个 `memory_classified_status` 工具：
- 返回结构化元数据（每个类型的条目数、索引状态）
- 不返回文件内容（AI 使用原生 Read 工具读取内容）
- 注册为 `halo-classified-memory` MCP server

---

### 7.6 Daily Log 工作日志

**实现文件**: `dailylog.ts` (156 行，新建)

#### 概述

KAIROS 模式（长期助理）的 daily log，用于记录工作期间的所有活动。

```
日志流：AI 通过 system prompt 指令维护
    ↓
存储：{haloDir}/memory/logs/YYYY/MM/YYYY-MM-DD.md
    ↓
注入：每次对话启动时，读取近 3 天日志作为上下文
    ↓
整合：consolidation 后台提取到全局分类记忆
```

#### 文件格式

```markdown
# 2026-05-11 Work Log

## 10:30 — 标题
- 做了什么
- 关键决策
- 重要发现
```

#### 路径函数

| 函数 | 用途 |
|------|------|
| `getDailyLogDir()` | `{haloDir}/memory/logs/` |
| `getDailyLogPath(dateStr?)` | `logs/2026/05/2026-05-11.md` |
| `ensureDailyLogDirs(dateStr?)` | mkdir -p |
| `readDailyLog(dateStr?)` | 读取单日日志 |
| `readRecentDailyLogs(days=3)` | 读取最近 N 天日志 |
| `appendToDailyLog(title, body)` | 追加时间戳条目（后端用） |
| `buildDailyLogContext(days=3, maxChars=4000)` | 构建注入用的格式化字符串 |

#### System Prompt 指令

`prompt.ts:290-338` 中的 `DAILY_LOG_INSTRUCTIONS` 告诉 AI：
- 在每次对话完成前，追加一条时间戳摘要到当天日志
- 格式：`## HH:MM — 标题` + 要点
- 记录：做了什么、决策、发现、进度、学习
- 不记录：文件路径、git 记录、临时调试步骤、凭据

---

### 7.7 后台整合 (Consolidation)

**实现文件**: `consolidation.ts` (260 行，新建)

#### 工作机制

```
每日日志有新内容（行数增加）
    ↓
findNewLogContent() — 对比 .consolidated.json 追踪文件
    ↓
如果新增行数 ≥3，调用 Sonnet 分析新内容
    ↓
提取 durable 信息 → 写入全局 classified 记忆 (user / knowledge)
    ↓
更新 .consolidated.json 追踪行号
```

#### 关键设计

| 决策 | 选择 | 理由 |
|------|------|------|
| **模型** | `claude-sonnet-4-20250514` | 便宜、够用 |
| **目标类型** | 全局 `user` + `knowledge` | feedback/project/reference 归属空间级 |
| **追踪方式** | `{logsDir}/.consolidated.json` | 记录每文件的已处理行数 |
| **最少新增行** | 3 行 | 避免碎片化调用 |
| **冷却** | 5 分钟（与 extractMemories 共享） | 避免频繁调用 |
| **去重** | 按 name 匹配已有条目 | 防止重复写入 |

#### 处理流程

1. `findNewLogContent()` — 读取日志文件，减去已追踪行数，得到新增段落
2. `consolidateLogToMemories()` — 调用 Sonnet，prompt 包含全量日志 + 新增内容
3. `writeConsolidatedMemories()` — 写入全局 `user/` 或 `knowledge/` 目录
4. 更新追踪文件行号

---

### 7.8 集成架构 (send-message.ts)

```
用户发送消息
    ↓
buildMemoryContext() 注入:
  ├── Memory 指令 (memory.md V3 用法)
  ├── 分类记忆指令 (五类型分类法)
  ├── Daily Log 指令 (日志维护规则)
  ├── 当前记忆状态 (相关性召回 ≤5 条)
  └── 最近 3 天工作日志
    ↓
AI 处理并回复
    ↓
Fire-and-forget 链:
  1. extractMemories()     → 对话 → 空间分类记忆
  2. consolidateDailyLog() → dailylog → 全局分类记忆
    ↓
完成
```

#### 关键代码 (send-message.ts:419-451)

```typescript
// extractMemories + consolidateDailyLog 串联为 fire-and-forget 链
extractMemories({ ... })
  .then(result => {
    // 提取对话到空间记忆
    return consolidateDailyLog(credentials)  // 接着整合日志到全局记忆
  })
  .then(consolidationResult => {
    console.log(`${consolidationResult.saved} memories saved`)
  })
  .catch(err => {
    console.error('Background memory failed:', err)
  })
```

#### 三个注入来源

| 注入内容 | 来源函数 | 更新时机 |
|----------|----------|----------|
| Memory 指令 | `generatePromptInstructions()` | 每次对话 |
| 分类记忆快照 | `findRelevantClassifiedMemories()` | 每次对话（side-query） |
| 近期日志 | `buildDailyLogContext()` | 每次对话 |

---

## 当前记忆状态分析 (2026-05-11)

### 存储现状

```
全局 (/Users/tal/.devx/memory/)
  user/        ← 空（consolidation 未运行过）
  feedback/    ← 空（无人写入，见下文 gap 分析）
  project/     ← 空
  reference/   ← 空
  knowledge/   ← 空（consolidation 未运行过）
  logs/
    2026/05/2026-05-11.md  ← 有初始条目
  MEMORY.md    ← 不存在

空间 (/Users/tal/go/src/dev_repos/.devx/memory/)
  user/        ← 空
  feedback/    ← 空
  project/     ← 空
  reference/   ← 空
  knowledge/   ← 空
  MEMORY.md    ← 不存在
```

### 为什么全是空的

1. **代码未部署** — extractMemories、consolidateDailyLog、dailylog 都是本次会话才写的，尚未在运行环境中执行过
2. **之前只靠 AI 自觉写** — 旧的 system prompt 教了 AI "你可以写分类记忆"，但 AI 可能在多轮对话中判断"没有值得保存的"
3. **目录是 ensureClassifiedMemoryDirs 创建的** — 每次对话都会创建目录，但目录本身不代表有内容

### 已知 Gap：全局 feedback 无人写入

| 机制 | 作用域 | 是否写全局 feedback |
|------|--------|---------------------|
| `extractMemories()` | `space` | 写 `{spacePath}/.devx/memory/feedback/` |
| `consolidateDailyLog()` | `global` | 只写 `user` + `knowledge` |
| AI 自主写 (prompt 指令) | space | 指令说 feedback 是 space scope |
| 结论 | — | **全局 feedback 永远为空** |


### 与 Claude Code 对比 (更新)

| 维度 | Claude Code | DevX (已实现) | DevX (待实现) |
|------|-------------|---------------|---------------|
| 核心记忆 | memdir（四类型 + MEMORY.md 索引） | classified 五类型 + MEMORY.md 索引 | — |
| 交互聊天注入 | system prompt 缓存（含指令 + 索引） | memory context 注入 + MCP 工具 + 近期日志 | — |
| 相关性召回 | Sonnet side-query（选 5 条） | Sonnet side-query（选 5 条） | — |
| 后台提取 | Extract Memories（forked agent） | Extract Memories（直接 API 调用） | — |
| 工作日志 | KAIROS daily logs | Daily Log（auto-load 3天 + 指令维护） | — |
| 日志整合 | AutoDream consolidates daily logs | consolidateDailyLog（后台 Sonnet 提取） | — |
| 容量保护 | 200 行 / 25KB + truncation | 200 行 / 25KB + truncation | — |
| 夜间整理 | AutoDream（三闸门调度） | — | AutoDream |
| 会话记忆 | Session Memory（forked agent） | — | Session Memory |
| 团队记忆 | Team Memory Sync（ETag + delta sync） | — | — |
| 记忆类型 | 4 种 (user/feedback/project/reference) | 5 种 (+ knowledge) | — |

### 实现差异说明

| 维度 | Claude Code | DevX |
|------|-------------|------|
| **提取方式** | Forked agent (完美克隆会话，子 agent 自主写文件) | 直接 API 调用，DevX 后端解析 JSON 后写文件 |
| **互斥锁** | 文件 mtime 检测（主 agent 已写则跳过） | 无（DevX 中只有后台提取在写，无竞争） |
| **游标追踪** | 按 message UUID 增量处理 | 不追踪游标，每次都传全量对话（有 50K 字符截断） |
| **冷却机制** | 无显式冷却（上游逻辑自然控制频率） | 5 分钟 per-conversation cooldown + 5 分钟 global cooldown |
| **提取模型** | 主 agent 使用的模型（forked agent 共享） | 固定 `claude-sonnet-4-20250514` |
| **工作日志** | 可选 feature gate (KAIROS) | Always-on，自动注入 + 后台 consolidation |
| **日志整合** | AutoDream: ≥24h + ≥5 会话 + 文件锁 | consolidateDailyLog: 每次对话后，行数追踪 |

---
