# Claude Code 工具系统源码分析

> 源码路径: `claude-code-source/src/`
> 分析日期: 2026-05-14

---

## 概述

Claude Code 共有 **42 个内置工具** + 若干 feature-gated 工具 + MCP 工具。工具系统遵循 **Registry → Filter → Dispatcher** 三层架构：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claude Code 工具系统整体架构                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 1: 工具定义 (Tool.ts)                                    │    │
│  │                                                                 │    │
│  │  Tool<Input, Output, P> 类型 — 每个工具的核心接口               │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │  call() — 执行逻辑                                      │    │    │
│  │  │  description() / prompt() — 注入 AI 的描述              │    │    │
│  │  │  isReadOnly() / isDestructive() — 安全分类               │    │    │
│  │  │  checkPermissions() — 权限校验                          │    │    │
│  │  │  isConcurrencySafe() — 并发控制                         │    │    │
│  │  │  renderToolUseMessage() — UI 渲染                       │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 2: 工具注册 (tools.ts)                                   │    │
│  │                                                                 │    │
│  │  getAllBaseTools()      getTools()     assembleToolPool()       │    │
│  │  ┌─────────────┐      ┌───────────┐   ┌──────────────────┐     │    │
│  │  │ 42 内置工具  │ ──→ │ 运行时过滤 │──→│ 内置 + MCP 合并  │     │    │
│  │  │ + feature   │      │ Simple/REPL│   │ 去重(内置优先)  │     │    │
│  │  │ gated 工具  │      │ isEnabled │   └──────────────────┘     │    │
│  │  └─────────────┘      └───────────┘                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 3: 工具执行 (toolOrchestration.ts / toolExecution.ts)     │    │
│  │                                                                 │    │
│  │  runTools() → 分拆并发/串行批次                                   │    │
│  │     ↓                                                           │    │
│  │  runToolUse() → 每个工具的执行流水线                              │    │
│  │     ↓                                                           │    │
│  │  1. Zod schema 校验    5. 权限决策 (allow/deny/ask)             │    │
│  │  2. validateInput()    6. tool.call() — 实际执行                │    │
│  │  3. Pre-tool hooks     7. mapToolResultToToolResultBlockParam   │    │
│  │  4. 权限检查            8. Post-tool hooks                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 4: 安全与权限 (constants/tools.ts / permissions.ts)       │    │
│  │                                                                 │    │
│  │  ALL_AGENT_DISALLOWED_TOOLS     ASYNC_AGENT_ALLOWED_TOOLS       │    │
│  │  COORDINATOR_MODE_ALLOWED_TOOLS  IN_PROCESS_TEAMMATE_ALLOWED    │    │
│  │                                                                 │    │
│  │  权限决策链: deny rules → ask rules → mode → tool-specific → 弹窗│    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 5: 工具延迟加载 (ToolSearch)                             │    │
│  │                                                                 │    │
│  │  shouldDefer → 初始 prompt 隐藏 schema                          │    │
│  │  通过 ToolSearch 按需加载 → 节省上下文窗口                       │    │
│  │  MCP 工具始终 defer，alwaysLoad 工具永不 defer                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 一、核心工具类型 — `Tool.ts`

**路径**: `src/Tool.ts`

`Tool<Input, Output, P>` 是所有工具的根接口（第 362-695 行），约 40+ 个字段。核心方法：

### 必需字段

| 字段 | 类型 | 用途 |
|------|------|------|
| `name` | `string` | 工具名称，即 AI 调用的函数名 |
| `inputSchema` | `ZodSchema<Input>` | Zod 校验器，定义输入参数的 schema |
| `call()` | `(args, context) => ToolResult` | 工具的具体执行逻辑 |
| `description()` | `(input, options) => string` | 给 AI 的动态描述 |
| `prompt()` | `(options) => string` | 注入 system prompt 的说明文本 |

### 安全与分类字段

| 字段 | 默认值 | 用途 |
|------|--------|------|
| `isEnabled()` | `true` | 当前环境是否可用 |
| `isConcurrencySafe()` | `false` | 能否与其它工具并行执行 |
| `isReadOnly()` | `false` | 只读工具（无副作用） |
| `isDestructive()` | `false` | 破坏性工具（不可逆操作） |
| `checkPermissions()` | `allow` | 工具级权限校验 |

### UI 渲染字段

| 字段 | 用途 |
|------|------|
| `userFacingName()` | 用户看到的名称 |
| `renderToolUseMessage()` | 工具调用时的 UI 消息 |
| `renderToolResultMessage()` | 工具返回结果的 UI 渲染 |
| `renderToolUseProgressMessage()` | 进度渲染 |
| `renderToolUseErrorMessage()` | 错误渲染 |

### `buildTool()` 工厂函数

```typescript
// Tool.ts:783-792 — 从部分定义构建完整工具
export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
}
```

`TOOL_DEFAULTS`（第 757-769 行）提供安全默认值：`isEnabled`=true, `isConcurrencySafe`=false, `isReadOnly`=false, `isDestructive`=false, `checkPermissions`=always allow。

---

## 二、工具注册 — `tools.ts`

**路径**: `src/tools.ts`

### `getAllBaseTools()` — 主注册表

第 193-251 行，所有内置工具的单一数据源。返回工具类/引用的数组，在注册时通过条件判断进行 feature gate：

```typescript
// tools.ts:193-251 — 主注册表（节选）
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool, FileEditTool, FileWriteTool,
    NotebookEditTool, WebFetchTool, TodoWriteTool,
    WebSearchTool, TaskStopTool, AskUserQuestionTool,
    SkillTool, EnterPlanModeTool,
    // ...feature-gated tools...
    ...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
  ]
}
```

**Feature gate 条件**：

| 门闸 | 条件 | 工具 |
|------|------|------|
| Ant 员工 | `process.env.USER_TYPE === 'ant'` | `ConfigTool`, `TungstenTool` |
| Web 浏览器 | `feature('WEB_BROWSER_TOOL')` | `WebBrowserTool` |
| 终端面板 | `feature('TERMINAL_PANEL')` | `TerminalCaptureTool` |
| 上下文折叠 | `feature('CONTEXT_COLLAPSE')` | `CtxInspectTool` |
| Overflow 测试 | `feature('OVERFLOW_TEST_TOOL')` | `OverflowTestTool` |
| 历史裁剪 | `feature('HISTORY_SNIP')` | `SnipTool` |
| KAIROS 模式 | `feature('KAIROS')` | `SendUserFileTool`, `PushNotificationTool` |
| KAIROS 通知 | `feature('KAIROS_PUSH_NOTIFICATION')` | `PushNotificationTool` |
| GitHub Webhook | `feature('KAIROS_GITHUB_WEBHOOKS')` | `SubscribePRTool` |
| Todo v2 | `isTodoV2Enabled()` | `TaskCreate/Get/Update/ListTool` |
| Workflow 脚本 | `feature('WORKFLOW_SCRIPTS')` | `WorkflowTool` |
| 测试模式 | `process.env.NODE_ENV === 'test'` | `TestingPermissionTool` |

### `getTools()` — 运行时过滤

第 271-327 行，在 `getAllBaseTools()` 的基础上应用运行时过滤：

1. **Simple 模式** (`CLAUDE_CODE_SIMPLE`): 仅保留 `Bash`、`Read`、`Edit`（+ coordinator 模式下的 `Agent`/`TaskStop`/`SendMessage`）
2. **REPL 模式**: 隐藏 `REPL_ONLY_TOOLS`
3. **Deny rules**: 通过 `filterToolsByDenyRules()` 检查 `alwaysDenyRules`
4. **isEnabled()**: 调用每个工具的 `isEnabled()` 方法

### `assembleToolPool()` — 工具池组装

第 345-367 行，合并内置工具 + MCP 工具：

```typescript
export function assembleToolPool(permissionContext, mcpTools): Tools {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  const byName = (a, b) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',  // 内置工具同名优先
  )
}
```

---

## 三、完整工具清单

### 3.1 文件操作类 (5个)

| 工具名 | 描述 | 只读 | 并发安全 |
|--------|------|------|---------|
| `Read` | 读取本地文件内容 | ✓ | ✓ |
| `Write` | 写入内容到文件 | ✗ | ✗ |
| `Edit` | 原地修改文件内容 | ✗ | ✗ |
| `Glob` | 按 glob 模式匹配文件名 | ✓ | ✓ |
| `Grep` | 用正则搜索文件内容 (ripgrep) | ✓ | ✓ |

Source: `FileReadTool`, `FileWriteTool`, `FileEditTool`, `GlobTool`, `GrepTool`

### 3.2 Shell执行类 (2个)

| 工具名 | 描述 | 只读 | 并发安全 |
|--------|------|------|---------|
| `Bash` | 执行 Shell 命令 | 取决于命令 | ✗ |
| `PowerShell` | 执行 PowerShell 命令 | 取决于命令 | ✗ |

Source: `BashTool`, `PowerShellTool`

### 3.3 网络类 (2个)

| 工具名 | 描述 | 只读 | 并发安全 |
|--------|------|------|---------|
| `WebSearch` | 搜索网页并返回结构化结果 | ✓ | ✓ |
| `WebFetch` | 获取 URL 内容并 AI 处理 | ✓ | ✓ |

Source: `WebSearchTool`, `WebFetchTool`

### 3.4 子代理/任务类 (6个)

| 工具名 | 描述 | 说明 |
|--------|------|------|
| `Agent` | 委托任务给子 agent | 核心 delegation 机制 |
| `TaskStop` | 停止后台任务 | 仅主 agent 可用 |
| `TaskOutput` | 获取后台任务输出 | 仅主 agent 可用 |
| `SendMessage` | 向其他 agent 发送消息 | 用于多 agent 通信 |
| `TaskCreate` | 创建任务 (v2) | todo v2 模式 |
| `TaskGet / Update / List` | 任务操作 (v2) | todo v2 模式 |

Source: `AgentTool`, `TaskStopTool`, `TaskOutputTool`, `SendMessageTool`, `TaskCreateTool` etc.

### 3.5 计划模式类 (2个)

| 工具名 | 描述 |
|--------|------|
| `EnterPlanMode` | 进入计划模式 |
| `ExitPlanMode` | 退出计划模式 |

Source: `EnterPlanModeTool`, `ExitPlanModeTool`

### 3.6 用户交互类 (2个)

| 工具名 | 描述 |
|--------|------|
| `AskUserQuestion` | 向用户提问 |
| `Brief` / `SendUserMessage` | 向用户发送消息 |

Source: `AskUserQuestionTool`, `BriefTool`

### 3.7 技能/配置类 (2个)

| 工具名 | 描述 |
|--------|------|
| `Skill` | 调用已安装的技能 |
| `Config` | 查看/管理配置 (仅 Ant 员工) |

Source: `SkillTool`, `ConfigTool`

### 3.8 Notebook类 (1个)

| 工具名 | 描述 |
|--------|------|
| `NotebookEdit` | 编辑 Jupyter notebook 单元格 |

Source: `NotebookEditTool`

### 3.9 调度与远程类 (5个)

| 工具名 | 描述 |
|--------|------|
| `Sleep` | 延迟/定时执行 |
| `CronCreate` | 创建定时任务 |
| `CronDelete` | 删除定时任务 |
| `CronList` | 列出定时任务 |
| `RemoteTrigger` | 触发远程 agent |

Source: `SleepTool`, `ScheduleCronTool`, `RemoteTriggerTool`

### 3.10 内部/高级类 (4个)

| 工具名 | 描述 | 说明 |
|--------|------|------|
| `ToolSearch` | 按需加载 deferred 工具的 schema | 节省 prompt 上下文 |
| `TodoWrite` | 更新待办列表 | 用于 task planning |
| `LSP` | Language Server Protocol 操作 | 语言智能 |
| `StructuredOutput` | coordinator 模式的结构化输出 | 仅子 agent |

Source: `ToolSearchTool`, `TodoWriteTool`, `LSPTool`, `SyntheticOutputTool`

### 3.11 团队与工作区类 (4个)

| 工具名 | 描述 |
|--------|------|
| `TeamCreate` | 创建多 agent 团队 |
| `TeamDelete` | 删除团队 |
| `EnterWorktree` | 进入隔离工作区 |
| `ExitWorktree` | 退出工作区 |

Source: `TeamCreateTool`, `TeamDeleteTool`, `EnterWorktreeTool`, `ExitWorktreeTool`

### 3.12 MCP类 (2个)

| 工具名 | 描述 |
|--------|------|
| `ListMcpResourcesTool` | 列出 MCP 服务器资源 |
| `ReadMcpResourceTool` | 读取 MCP 服务器资源 |

Source: `ListMcpResourcesTool`, `ReadMcpResourceTool`

### 3.13 工具分类总表

```
文件操作 (5):   Read  Write  Edit  Glob  Grep
Shell执行 (2):  Bash  PowerShell
网络类   (2):   WebSearch  WebFetch
子代理类 (6):   Agent  TaskStop  TaskOutput  SendMessage  TaskCreate/Get/Update/List
计划模式 (2):   EnterPlanMode  ExitPlanMode
用户交互 (2):   AskUserQuestion  Brief/SendUserMessage
技能配置 (2):   Skill  Config (ant only)
Notebook (1):   NotebookEdit
调度远程 (5):   Sleep  CronCreate/Delete/List  RemoteTrigger
内部高级 (4):   ToolSearch  TodoWrite  LSP  StructuredOutput
团队工作区 (4): TeamCreate  TeamDelete  EnterWorktree  ExitWorktree
MCP类    (2):   ListMcpResources  ReadMcpResource
```

---

## 四、工具执行流水线

### 4.1 概述

AI 返回 stream 中的 `tool_use` blocks 经过以下路径：

```
API stream → StreamingToolExecutor → runToolUse() → 结果 → tool_result message
```

### 4.2 `runTools()` — 批次编排

**路径**: `src/services/tools/toolOrchestration.ts`

将连续的 tool_use blocks 拆分为并发/串行批次：

```typescript
export async function* runTools(toolUseMessages, assistantMessages, canUseTool, toolUseContext) {
  let currentContext = toolUseContext
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(toolUseMessages, currentContext)) {
    if (isConcurrencySafe) {
      yield* runToolsConcurrently(blocks, ...)  // 只读并行
    } else {
      yield* runToolsSerially(blocks, ...)       // 非只读串行
    }
  }
}
```

**并行策略**：连续的并发安全工具组成一个批次。非并发工具打断批次，单独串行执行。

### 4.3 StreamingToolExecutor — 流式执行

**路径**: `src/services/tools/StreamingToolExecutor.ts`

| 方法 | 功能 |
|------|------|
| `addTool()` | 入队工具并开始处理 |
| `executeTool()` | 通过 `runToolUse()` 执行 |
| `getCompletedResults()` | 非阻塞获取已完成结果 |
| `getRemainingResults()` | 异步等待剩余工具完成 |

**Sibling abort**：如果某个 Bash 工具报错，同批次的兄弟工具通过 `siblingAbortController` 被中止。

### 4.4 `runToolUse()` — 单工具执行流水线

**路径**: `src/services/tools/toolExecution.ts`

完整的单工具执行流水线：

```
1. 按名称查找工具 (tool pool lookup)
2. 别名回退 (如果未找到原名)
3. Zod schema 校验 (inputSchema.parse)
4. tool-specific validateInput()
5. 投机分类器 (仅 Bash: 预判命令是否危险)
6. Pre-tool hooks (可阻挡、修改输入)
7. 权限决策: allow / deny / ask
8. tool.call() — 实际执行
9. mapToolResultToToolResultBlockParam — 结果序列化
10. Post-tool hooks (可修改输出)
11. Post-tool failure hooks (出错时)
```

权限决策链 (`checkPermissionsAndCallTool`, 第 599 行+)：

```
validateInput → Pre-tool hooks → hasPermissionsToUseTool
    → allow? → tool.call()
    → deny?  → 返回拒绝消息
    → ask?   → 弹窗询问用户 / 委托 coordinator / swarm 处理
```

---

## 五、工具权限与安全

### 5.1 工具分类常量

**路径**: `src/constants/tools.ts`

#### ALL_AGENT_DISALLOWED_TOOLS — 子 agent 禁用

```typescript
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,      // TaskOutput
  EXIT_PLAN_MODE_V2_TOOL_NAME, // ExitPlanMode
  ENTER_PLAN_MODE_TOOL_NAME,   // EnterPlanMode
  ASK_USER_QUESTION_TOOL_NAME, // AskUserQuestion
  TASK_STOP_TOOL_NAME,        // TaskStop
  ...(USER_TYPE === 'ant' ? [] : [AGENT_TOOL_NAME]), // Agent
])
```

#### ASYNC_AGENT_ALLOWED_TOOLS — 异步 agent 白名单

后台异步 agent（如 ExtractMemories）只能使用这些安全工具：

```typescript
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,    // Read
  WEB_SEARCH_TOOL_NAME,   // WebSearch
  TODO_WRITE_TOOL_NAME,   // TodoWrite
  GREP_TOOL_NAME,         // Grep
  WEB_FETCH_TOOL_NAME,    // WebFetch
  GLOB_TOOL_NAME,         // Glob
  ...SHELL_TOOL_NAMES,    // Bash + PowerShell
  FILE_EDIT_TOOL_NAME,    // Edit
  FILE_WRITE_TOOL_NAME,   // Write
  NOTEBOOK_EDIT_TOOL_NAME, // NotebookEdit
  SKILL_TOOL_NAME,        // Skill
  SYNTHETIC_OUTPUT_TOOL_NAME, // StructuredOutput
  TOOL_SEARCH_TOOL_NAME,  // ToolSearch
  ENTER_WORKTREE_TOOL_NAME,  // EnterWorktree
  EXIT_WORKTREE_TOOL_NAME,   // ExitWorktree
])
```

#### COORDINATOR_MODE_ALLOWED_TOOLS — coordinator 模式白名单

```typescript
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,            // Agent
  TASK_STOP_TOOL_NAME,        // TaskStop
  SEND_MESSAGE_TOOL_NAME,     // SendMessage
  SYNTHETIC_OUTPUT_TOOL_NAME, // StructuredOutput
])
```

#### IN_PROCESS_TEAMMATE_ALLOWED_TOOLS — swarm 模式扩展

```typescript
export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set([
  TASK_CREATE_TOOL_NAME, TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME, TASK_UPDATE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
])
```

### 5.2 工具过滤 — `filterToolsForAgent()`

**路径**: `src/tools/AgentTool/agentToolUtils.ts`

```
对 forked agent = 过滤工具
    1. MCP 工具 (mcp__ 前缀) → 始终允许
    2. ExitPlanMode → 仅在 plan mode 允许
    3. ALL_AGENT_DISALLOWED_TOOLS → 阻断
    4. 自定义 agent CUSTOM_DISALLOWED → 阻断
    5. 异步 agent → 限定 ASYNC_AGENT_ALLOWED_TOOLS
```

### 5.3 权限系统 — `hasPermissionsToUseTool()`

**路径**: `src/utils/permissions/permissions.ts`

5 步决策链：

```
Step 1a: alwaysDenyRules     → 匹配则立即拒绝
Step 1b: alwaysAskRules      → 匹配则弹出确认
Step 2:   权限模式判断
           - bypassPermissions  → 全部放行
           - acceptEdits        → 文件编辑自动放行
           - auto               → AI 自行判断
           - default            → 标准弹窗
           - dontAsk            → 全部拒绝
           - plan               → 计划模式限制
Step 3:   tool.checkPermissions() → 工具特有校验
Step 4:   弹窗或自动决策
```

**权限模式** (`PermissionMode`):

| 模式 | 行为 | 用途 |
|------|------|------|
| `default` | 标准弹窗 | 交互模式 |
| `acceptEdits` | 文件编辑自动放行 | 开发者信任模式 |
| `bypassPermissions` | 全部自动放行 | 后台/自动化 |
| `dontAsk` | 全部拒绝 | 只读模式 |
| `plan` | 计划模式限制 | 规划阶段 |
| `auto` | AI 自行判断危险操作 | 异步 agent |
| `bubble` | 传给父进程 | 子 agent |

### 5.4 工具级安全属性

每个工具通过 4 个布尔方法上报安全特征：

```
isReadOnly(input)      → 本次调用是否只读（决定并发 + 权限）
isDestructive(input)   → 是否有不可逆操作（决定是否额外警告）
isConcurrencySafe(input) → 能否并行（决定批次编排）
isEnabled()            → 当前环境是否可用（特征门闸）
```

---

## 六、工具延迟加载 — ToolSearch

**路径**: `src/tools/ToolSearchTool/`

为了节省上下文窗口，部分工具的 schema 不在初始 prompt 中暴露，而是通过 `ToolSearch` 机制按需加载。

### 延迟规则

```typescript
// ToolSearchTool/prompt.ts:62-108
- MCP 工具 → 始终 defer
- alwaysLoad: true → 永不 defer (如 ToolSearch 本身)
- Agent (fork-subagent) → 永不 defer
- Brief/SendUserMessage → 永不 defer
- 其他工具 → 默认 defer (若 shouldDefer: true)
```

### 调用流程

```
1. AI 收到初始 prompt（不含 deferred 工具的 schema）
2. AI 调用 ToolSearch("find a tool to...")
3. ToolSearch 返回匹配工具的完整 schema
4. AI 现在可以使用该工具
```

---

## 七、核心源码节选

### 7.1 工具类型定义 — `Tool.ts`

```typescript
// Tool.ts:362-695 — Tool 类型（核心接口节选）
export type Tool<Input, Output, P> = {
  readonly name: string
  readonly inputSchema: Input
  readonly strict?: boolean
  readonly shouldDefer?: boolean
  readonly alwaysLoad?: boolean
  maxResultSizeChars: number
  isMcp?: boolean

  call(args, context, canUseTool, parentMessage, onProgress): Promise<ToolResult<Output>>
  description(input, options): Promise<string>
  prompt(options): Promise<string>

  isEnabled(): boolean
  isConcurrencySafe(input): boolean
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  checkPermissions(input, context): Promise<PermissionResult>
  validateInput?(input, context): Promise<ValidationResult>

  userFacingName(input): string
  renderToolUseMessage(input, options): React.ReactNode
  renderToolResultMessage(content, progress, options): React.ReactNode
}
```

### 7.2 默认值 — `Tool.ts`

```typescript
// Tool.ts:757-769 — 工具安全默认值
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => false,
  checkPermissions: () => ({ behavior: 'allow' as const, updatedInput: input }),
  toAutoClassifierInput: () => '',
  userFacingName: (input) => def.name,
} as const
```

### 7.3 主注册表 — `tools.ts`

```typescript
// tools.ts:193-251 — getAllBaseTools() 节选
export function getAllBaseTools(): Tools {
  return [
    AgentTool, TaskOutputTool, BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool, FileEditTool, FileWriteTool,
    NotebookEditTool, WebFetchTool, TodoWriteTool,
    WebSearchTool, TaskStopTool, AskUserQuestionTool,
    SkillTool, EnterPlanModeTool,
    // ...feature gates...
  ]
}
```

### 7.4 工具池组装 — `tools.ts`

```typescript
// tools.ts:345-367 — assembleToolPool()
export function assembleToolPool(permissionContext, mcpTools): Tools {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}
```

### 7.5 执行编排 — `toolOrchestration.ts`

```typescript
// toolOrchestration.ts — runTools() 批次编排
// 并发安全工具在同一批次并行执行
// 非并发工具打断批次，串行执行
```

### 7.6 权限常量 — `constants/tools.ts`

```typescript
// constants/tools.ts:36-71 — 工具权限分类
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME, EXIT_PLAN_MODE_V2_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME, ASK_USER_QUESTION_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
])

export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME, WEB_SEARCH_TOOL_NAME, TODO_WRITE_TOOL_NAME,
  GREP_TOOL_NAME, WEB_FETCH_TOOL_NAME, GLOB_TOOL_NAME,
  ...SHELL_TOOL_NAMES, FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME,
])
```

### 7.7 子 agent 工具过滤 — `agentToolUtils.ts`

```typescript
// AgentTool/agentToolUtils.ts:70-116 — 工具过滤
function filterToolsForAgent(tools, isAsync) {
  return tools.filter(t => {
    if (t.name.startsWith('mcp__')) return true   // MCP 始终允许
    if (ALL_AGENT_DISALLOWED_TOOLS.has(t.name)) return false
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(t.name)) return false
    return true
  })
}
```

---

## 八、关键设计原则

1. **Registry → Filter → Dispatcher**：三层架构清晰分离职责，注册、过滤、执行各自独立，可单独测试和扩展。

2. **安全默认值**：`buildTool()` 默认所有工具非并发、非只读、非破坏性，需要工具开发者显式声明安全属性。

3. **分层权限**：deny rules（硬阻断）、ask rules（用户确认）、权限模式（全局开关）、工具级校验（特定场景）四层叠加，精细控制。

4. **Agent 权限收紧**：子 agent 默认禁用危险工具（`ALL_AGENT_DISALLOWED_TOOLS`），异步 agent 进一步限定白名单（`ASYNC_AGENT_ALLOWED_TOOLS`），安全逐层收紧。

5. **并发友好**：只读、无副作用的工具声明 `isConcurrencySafe`，执行引擎自动批量并行；写操作工具串行，避免竞态。

6. **ToolSearch 延迟加载**：减少初始 prompt 大小，按需暴露工具 schema，节省上下文窗口给更重要的内容。

7. **Feature gate**：54% 的工具通过环境变量/feature flag 条件注册，不全部加载，控制启动成本。
