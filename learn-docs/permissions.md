# Claude Code 权限系统源码分析

> 源码路径: `claude-code-source/src/`
> 分析日期: 2026-05-14

---

## 概述

Claude Code 的权限系统遵循 **Rule → Mode → Tool → Classifier** 四层决策链，与工具执行管线深度集成：

```
toolOrchestration.ts → runTools()
    │
    ▼
toolExecution.ts → checkPermissionsAndCallTool()
    │
    ▼
useCanUseTool() [React Hook — 桥接引擎与 UI]
    │
    ├── hasPermissionsToUseTool() [权限引擎核心]
    │   │
    │   └── hasPermissionsToUseToolInner()
    │        ├── 1a ■ deny rules           ← 管理员黑名单
    │        ├── 1b ■ ask rules            ← 管理员灰名单
    │        ├── 1c ▣ tool.checkPermissions()  ← 各工具自定义
    │        ├── 1d ■ tool denied          ← 工具自身拒绝
    │        ├── 1e ■ requiresUserInteraction  ← 必须弹窗
    │        ├── 1f ■ content ask rules    ← 内容级灰名单
    │        ├── 1g ■ safety checks        ← bypass 免疫
    │        ├── 2a ■ bypass mode          ← 全局放行
    │        └── 2b ■ always-allow / 3 passthrough→ask
    │
    └── Mode 变换（post-inner 处理）
         ├── dontAsk:  ask → deny
         ├── auto:     acceptEdits 快检 → allowlist → Classifier → denial tracking
         └── default:  无变换
    │
    ▼
Decision 分发（ask 结果）:
    ├── Coordinator Handler（awaitAutomatedChecksBeforeDialog 时）
    ├── Swarm Worker Handler（sub-agent 场景）
    ├── Speculative Classifier（2 秒竞速，仅 bash）
    └── Interactive Handler → UI 弹窗 + async hooks + async classifier
```

**核心文件清单**：

| 文件 | 作用 |
|------|------|
| `src/types/permissions.ts` | 权限数据类型定义 |
| `src/utils/permissions/permissions.ts` | 权限决策引擎（核心逻辑） |
| `src/utils/permissions/PermissionMode.ts` | 权限模式 UI 配置 |
| `src/utils/permissions/PermissionResult.ts` | 行为描述工具 |
| `src/utils/permissions/permissionRuleParser.ts` | 权限规则解析 |
| `src/utils/permissions/permissionSetup.ts` | 权限设置与模式切换 |
| `src/utils/permissions/dangerousPatterns.ts` | 危险模式定义 |
| `src/utils/permissions/bypassPermissionsKillswitch.ts` | bypass 模式 Killswitch |
| `src/constants/tools.ts` | 工具权限常量 |
| `src/hooks/useCanUseTool.tsx` | React Hook 桥接层 |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | 权限弹窗处理器 |
| `src/hooks/toolPermission/handlers/coordinatorHandler.ts` | 协调器权限处理器 |
| `src/tools/BashTool/bashPermissions.ts` | Bash 工具权限逻辑 |
| `src/tools/BashTool/modeValidation.ts` | 模式验证逻辑 |
| `src/services/tools/toolExecution.ts` | 工具执行管线 |
| `src/services/tools/toolOrchestration.ts` | 工具编排 |
| `src/utils/settings/permissionValidation.ts` | 权限规则验证 |

---

## 一、核心数据类型 — `permissions.ts`

**路径**: `src/types/permissions.ts`

### 三种基础行为

```typescript
type PermissionBehavior = 'allow' | 'deny' | 'ask'
```

这是权限系统的三个基本答案。还有一个内部使用的 `'passthrough'` 变体表示"没意见，让调用者决定"。

### PermissionResult

每种行为对应一个独立的结果类型：

```typescript
// 放行
type PermissionAllowDecision = {
  behavior: 'allow'
  updatedInput?: Input               // 用户/系统修改后的输入
  userModified?: boolean
  decisionReason?: PermissionDecisionReason
  toolUseID?: string
  acceptFeedback?: string
  contentBlocks?: ContentBlockParam[]
}

// 弹窗询问
type PermissionAskDecision = {
  behavior: 'ask'
  message: string                    // 向用户展示的消息
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  isBashSecurityCheckForMisparsing?: boolean
  pendingClassifierCheck?: PendingClassifierCheck
  contentBlocks?: ContentBlockParam[]
}

// 拒绝
type PermissionDenyDecision = {
  behavior: 'deny'
  message: string                    // 向模型返回的拒绝原因
  decisionReason: PermissionDecisionReason
  toolUseID?: string
}
```

### PermissionDecisionReason

记录决策原因的联合类型，在调试和日志中至关重要：

```typescript
type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }                          // 匹配到用户规则
  | { type: 'mode'; mode: PermissionMode }                          // 模式级别决策
  | { type: 'subcommandResults'; reasons: Map<string, PermissionResult> } // Bash 子命令粒度
  | { type: 'permissionPromptTool'; permissionPromptToolName: string; toolResult: unknown }
  | { type: 'hook'; hookName: string; hookSource?: string; reason?: string }
  | { type: 'asyncAgent'; reason: string }
  | { type: 'sandboxOverride'; reason: 'excludedCommand' | 'dangerouslyDisableSandbox' }
  | { type: 'classifier'; classifier: string; reason: string }
  | { type: 'workingDir'; reason: string }
  | { type: 'safetyCheck'; reason: string; classifierApprovable: boolean }
  | { type: 'other'; reason: string }
```

### PermissionRule

用户配置的规则：

```typescript
type PermissionRuleSource =
  | 'userSettings' | 'projectSettings' | 'localSettings'
  | 'flagSettings' | 'policySettings'
  | 'cliArg' | 'command' | 'session'

type PermissionRule = {
  source: PermissionRuleSource       // 规则来源
  ruleBehavior: PermissionBehavior   // allow | deny | ask
  ruleValue: {
    toolName: string                 // 工具名，如 "Bash"
    ruleContent?: string             // 内容模式，如 "npm run"
  }
}
```

### PermissionMode

```typescript
const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits', 'bypassPermissions', 'default', 'dontAsk', 'plan'
] as const

type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
type PermissionMode = InternalPermissionMode
```

### ToolPermissionContext

运行时状态对象，贯穿整个权限决策：

```typescript
type ToolPermissionContext = {
  readonly mode: PermissionMode
  readonly additionalWorkingDirectories: ReadonlyMap<string, AdditionalWorkingDirectory>
  readonly alwaysAllowRules: ToolPermissionRulesBySource
  readonly alwaysDenyRules: ToolPermissionRulesBySource
  readonly alwaysAskRules: ToolPermissionRulesBySource
  readonly isBypassPermissionsModeAvailable: boolean
  readonly strippedDangerousRules?: ToolPermissionRulesBySource
  readonly shouldAvoidPermissionPrompts?: boolean
  readonly awaitAutomatedChecksBeforeDialog?: boolean
  readonly prePlanMode?: PermissionMode
}
```

---

## 二、权限决策引擎 — `hasPermissionsToUseToolInner()`

**路径**: `src/utils/permissions/permissions.ts`

这是权限系统的核心函数。完整的 2 阶段 10 步决策链：

### 第一阶段：规则检查（1a - 1g，任何拒绝立即返回）

| 步骤 | 检查项 | 说明 |
|------|--------|------|
| 0 | Aborted signal | 对话已中止？ |
| 1a | Deny rules | 用户配置了该工具的拒绝规则？→ deny |
| 1b | Ask rules | 用户配置了该工具的询问规则？→ ask（Bash sandbox 例外） |
| 1c | tool.checkPermissions() | 工具自身的权限逻辑（Bash 最复杂） |
| 1d | Tool denied | checkPermissions 返回 deny？→ deny |
| 1e | requiresUserInteraction | 工具要求必须弹窗（AskUserQuestion、ExitPlanMode）？bypass 也拦截 |
| 1f | Content ask rules | 内容级别的 ask 规则？bypass 模式也拦截 |
| 1g | Safety checks | .git/、.claude/、.vscode/、shell 配置文件 → bypass **免疫** |

### 第二阶段：模式处理（2a - 3）

| 步骤 | 检查项 | 说明 |
|------|--------|------|
| 2a | Bypass mode | bypassPermissions 或 plan + bypassAvailable → allow |
| 2b | Always-allow rules | 用户配置了放行规则？→ allow |
| 3 | Passthrough→Ask | checkPermissions 返回 passthrough → 转为 ask |

### 外层 Mode 变换（post-inner）

`hasPermissionsToUseTool` 外层对结果做 Mode 变换：

1. **dontAsk 模式**（:508）：`ask → deny`，返回 `DONT_ASK_REJECT_MESSAGE`
2. **auto 模式**（:521）：多阶段自动决策：
   - 跳过非 classifier-approvable 的安全检查
   - 跳过 `requiresUserInteraction()` 的工具
   - **acceptEdits 快检**：用 acceptEdits mode 重跑 checkPermissions，若允许则放行
   - **安全工具 allowlist**（isAutoModeAllowlistedTool）
   - **YOLO Classifier**（classifyYoloAction）：AI 模型决策
   - **否决跟踪**（denialTracking.ts）：连续 3 次 / 累计 20 次否决 → 降级到弹窗

### 轻量级路径：`checkRuleBasedPermissions()`

用于 `bypassPermissions` 模式，只运行 1a-1g，跳过所有 mode 变换。返回 `null` 表示"没有规则阻止"。

---

## 三、权限模式详解

| 模式 | 行为 | 适用场景 | 关键机制 |
|------|------|----------|----------|
| `default` | 完整权限链，ask 弹窗 | 普通用户 | 标准决策流 |
| `bypassPermissions` | 自动放行所有操作 | 高级用户 / CI | 只检查 deny+safety，跳过所有弹窗 |
| `acceptEdits` | 自动放行文件操作 | 编辑密集型任务 | Bash 中 mkdir/touch/rm/mv/cp/sed 自动放行 |
| `dontAsk` | 所有 ask → deny | 只读模式 | 模型被告知"工具被策略拒绝" |
| `plan` | 计划模式，常配合 bypass | 架构规划 | 界面显示暂停图标，bypassAvailable 时如同 bypass |
| `auto` | AI classifier 自动决策 | ant 内部 | 多阶段分类器，否决跟踪，危险规则剥离 |
| `bubble` | 内部使用 | ant 内部 | 无单独 UI 配置 |

### PermissionMode UI 配置

**路径**: `src/utils/permissions/PermissionMode.ts`

```typescript
const PERMISSION_MODE_CONFIG = {
  default:     { title: 'Default',       shortTitle: 'Default', symbol: '',           color: 'text' },
  plan:        { title: 'Plan Mode',     shortTitle: 'Plan',   symbol: PAUSE_ICON,    color: 'planMode' },
  acceptEdits: { title: 'Accept edits',  shortTitle: 'Accept', symbol: '>>',          color: 'autoAccept' },
  bypassPermissions: { title: 'Bypass Permissions', shortTitle: 'Bypass', symbol: '>>', color: 'error' },
  dontAsk:     { title: "Don't Ask",     shortTitle: 'DontAsk',symbol: '>>',           color: 'error' },
  auto:        { title: 'Auto mode',     shortTitle: 'Auto',   symbol: '>>',           color: 'warning' },
}
```

---

## 四、关键权限常量

**路径**: `src/constants/tools.ts`（:36-112）

### ALL_AGENT_DISALLOWED_TOOLS

子代理（sub-agent、swarm worker）永远不能使用的工具：

```typescript
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,        // 读取 task 输出
  EXIT_PLAN_MODE_V2_TOOL_NAME,  // 退出计划模式
  ENTER_PLAN_MODE_TOOL_NAME,    // 进入计划模式
  ...(process.env.USER_TYPE === 'ant' ? [] : [AGENT_TOOL_NAME]),  // Agent 工具→ant 专用
  ASK_USER_QUESTION_TOOL_NAME,  // 向用户提问
  TASK_STOP_TOOL_NAME,          // 停止任务
  ...(feature('WORKFLOW_SCRIPTS') ? [WORKFLOW_TOOL_NAME] : []),   // 工作流脚本
])
```

### CUSTOM_AGENT_DISALLOWED_TOOLS

自定义代理额外禁止的工具（继承 ALL_AGENT_DISALLOWED_TOOLS）：

```typescript
export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
  // 额外限制
])
```

### ASYNC_AGENT_ALLOWED_TOOLS

后台异步代理明确允许的工具（不在集合中的工具不可用）：

```typescript
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,        // 读文件
  WEB_SEARCH_TOOL_NAME,       // 网页搜索
  TODO_WRITE_TOOL_NAME,       // 待办清单
  GREP_TOOL_NAME,             // 搜索内容
  WEB_FETCH_TOOL_NAME,        // 获取网页
  GLOB_TOOL_NAME,             // 搜索文件
  ...SHELL_TOOL_NAMES,        // 所有 shell 工具
  FILE_EDIT_TOOL_NAME,        // 编辑文件
  FILE_WRITE_TOOL_NAME,       // 写文件
  NOTEBOOK_EDIT_TOOL_NAME,    // 编辑 notebook
  SKILL_TOOL_NAME,            // 调用 skill
  SYNTHETIC_OUTPUT_TOOL_NAME, // 合成输出
  TOOL_SEARCH_TOOL_NAME,      // 工具搜索
  ENTER_WORKTREE_TOOL_NAME,   // 进入 worktree
  EXIT_WORKTREE_TOOL_NAME,    // 退出 worktree
])
```

### IN_PROCESS_TEAMMATE_ALLOWED_TOOLS

内进程队友（inProcessRunner.ts 注入的 agent）额外的工具：

```typescript
export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set([
  TASK_CREATE_TOOL_NAME,    // 创建子任务
  TASK_GET_TOOL_NAME,       // 获取任务
  TASK_LIST_TOOL_NAME,      // 列出任务
  TASK_UPDATE_TOOL_NAME,    // 更新任务
  SEND_MESSAGE_TOOL_NAME,   // 发消息给父 agent
  ...(feature('AGENT_TRIGGERS')
    ? [CRON_CREATE_TOOL_NAME, CRON_DELETE_TOOL_NAME, CRON_LIST_TOOL_NAME]
    : []),
])
```

### COORDINATOR_MODE_ALLOWED_TOOLS

协调器模式（swarm 场景）允许的工具：

```typescript
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,           // 创建/管理 agent
  TASK_STOP_TOOL_NAME,       // 停止任务
  SEND_MESSAGE_TOOL_NAME,    // 发消息
  SYNTHETIC_OUTPUT_TOOL_NAME, // 合成输出
])
```

### DANGEROUS_BASH_PATTERNS

**路径**: `src/utils/permissions/dangerousPatterns.ts`

进入 auto mode 时会自动剥离包含这些模式的 allow 规则：

```typescript
export const CROSS_PLATFORM_CODE_EXEC = [
  'python', 'python3', 'python2', 'node', 'deno', 'tsx',
  'ruby', 'perl', 'php', 'lua',
  'npx', 'bunx', 'npm run', 'yarn run', 'pnpm run', 'bun run',
  'bash', 'sh', 'ssh',
]

export const DANGEROUS_BASH_PATTERNS = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh', 'fish', 'eval', 'exec', 'env', 'xargs', 'sudo',
  ...(process.env.USER_TYPE === 'ant'
    ? ['fa run', 'coo', 'gh', 'gh api', 'curl', 'wget', 'git', 'kubectl', 'aws', 'gcloud', 'gsutil']
    : []),
]
```

> ant 用户有更多的危险模式（gh、curl、wget、kubectl、aws 等）。

---

## 五、Bash 权限详解 — `bashToolHasPermission()`

**路径**: `src/tools/BashTool/bashPermissions.ts`（:1663）

Bash 是权限系统中最复杂的工具。`checkPermissions` 调用 `bashToolHasPermission()` 实现：

### 决策流程

```typescript
bashToolHasPermission(input, context):
  │
  ├── 1. AST 解析 ← tree-sitter 解析命令
  │     提取 SimpleCommand 对象数组
  │
  ├── 2. 模式验证 (checkPermissionMode)
  │     acceptEdits: 文件操作自动放行
  │     bypass/dontAsk: 返回 passthrough
  │
  ├── 3. 路径约束 (checkPathConstraints)
  │     验证工作目录范围
  │
  ├── 4. Sed 约束 (checkSedConstraints)
  │     sed 内联编辑安全性
  │
  ├── 5. Bash 安全检察 (bashCommandIsSafeAsync)
  │     危险模式检测（legacy）
  │
  ├── 6. 操作符权限 (checkCommandOperatorPermissions)
  │     pipe、redirect、heredoc 等
  │
  ├── 7. 子命令级规则匹配
  │     对每个子命令（按 |、&&、|| 分隔）:
  │     ├── shell 前缀匹配 → deny rule?
  │     ├── shell 通配符匹配 → ask rule?
  │     └── shell 通配符匹配 → allow rule?
  │
  ├── 8. 工作目录规则
  │     对照 additionalWorkingDirectories
  │
  └── 9. 子命令决策合并
       最严格者胜出: deny > ask > allow > passthrough
```

### 命令权限前缀匹配

Bash 规则使用 shell 风格的前缀/通配符匹配：

- `Bash(npm run)` — 精确匹配命令前缀
- `Bash(npm:*)` — legacy 冒号风格
- `Bash(npm *)` — 通配符风格

### 子命令级决策合并

当命令包含 pipe 或逻辑运算符时（如 `npm test | tap-nyan`），每个子命令单独检查，结果合并：

| 子命令 1 | 子命令 2 | 合并结果 |
|----------|----------|----------|
| allow | allow | allow |
| allow | ask | ask |
| allow | deny | deny |
| ask | deny | deny |

**最严格者胜出** — deny > ask > allow > passthrough。

---

## 六、权限规则配置

### 规则来源

| 来源 | 配置方式 | 存储位置 |
|------|----------|----------|
| `userSettings` | 用户设置 | `~/.claude/settings.json` |
| `projectSettings` | 项目设置 | `<project>/.claude/settings.json` |
| `localSettings` | 本地设置 | 项目本地 |
| `cliArg` | CLI 参数 | `--allowedTools` / `--deniedTools` |
| `command` | 会话命令 | 对话中 `/permissions` 命令 |
| `session` | 会话临时 | 当前会话 |
| `policySettings` | 组织策略 | 托管策略 |
| `flagSettings` | 功能标志 | Statsig |

### 规则解析

**路径**: `src/utils/permissions/permissionRuleParser.ts`

规则字符串格式：

```
Bash              → 匹配整个工具
Bash(npm run)     → 工具+内容模式
Bash(npm:*)       → Bash 前缀匹配（legacy）
Bash(npm *)       → Bash 通配符匹配
```

### 规则验证

**路径**: `src/utils/settings/permissionValidation.ts`

- MCP 规则不能有内容模式
- 工具名必须以大写字母开头
- Bash 规则的 pattern 必须合法（`:*` 只能在末尾）
- File 工具规则的 glob 模式必须合法

---

## 七、React Hook 桥接层 — `useCanUseTool.tsx`

**路径**: `src/hooks/useCanUseTool.tsx`

`useCanUseTool` 是权限引擎与 UI/交互的桥梁：

```typescript
useCanUseTool(tool, input, context, assistantMessage?, toolUseID?)
  │
  ├── 1. 创建 PermissionContext
  ├── 2. 调用 hasPermissionsToUseTool() 获取初始决策
  │
  ├── allow → 立即返回 resolved
  ├── deny  → 记录日志，返回拒绝消息
  │
  └── ask   → 多路径竞争：
       ├── Coordinator Handler（awaitAutomatedChecks 时预检）
       ├── Swarm Worker Handler（sub-agent 转发）
       ├── Speculative Classifier（2s race，仅 bash）
       └── Interactive Handler → UI 弹窗
```

### 交互式权限弹窗

**路径**: `src/hooks/toolPermission/handlers/interactiveHandler.ts`

当权限需要用户确认时：

```
handleInteractivePermission()
  │
  ├── 1. 推送 ToolUseConfirm 到权限队列
  ├── 2. 设置竞争回调（createResolveOnce → atomic claim()）
  │
  ├── 本地用户: onAllow() / onReject() / onAbort()
  ├── Bridge (CCR): claude.ai 远程批准
  ├── Channel Relay: MCP 渠道（Telegram/iMessage）
  ├── PermissionRequest hooks: 自定义自动批准插件
  └── Async Classifier: 后台分类器自动判决（最快者赢）
```

---

## 八、工具执行管线集成

### toolExecution.ts

**路径**: `src/services/tools/toolExecution.ts`

`checkPermissionsAndCallTool()`（:599）是工具执行的核心检查点：

```typescript
async function checkPermissionsAndCallTool(...):
  │
  ├── 1. 调用 canUseTool() → 等待 PermissionDecision
  ├── 2. allow → 用 processedInput 执行工具
  ├── 3. deny  → 执行 executePermissionDeniedHooks() + 返回拒绝消息
  └── 4. ask   → 等待交互式弹窗（需用户确认）
```

### 工具编排集成

**路径**: `src/services/tools/toolOrchestration.ts`

`runTools()` 在编排阶段传入 `canUseTool` 函数，每个工具调用都会通过权限检查。并发和串行执行都使用相同的权限接口。

---

## 九、Special Cases

### bypass 免疫检查（Step 1g）

以下检查**即使 bypass mode 也无法绕过**：

- `.git/` 目录访问
- `.claude/` 目录访问
- `.vscode/` 目录访问
- shell 配置文件写操作
- `requiresUserInteraction()` 的工具

### bypass killswitch

**路径**: `src/utils/permissions/bypassPermissionsKillswitch.ts`

通过 Statsig gate 远程禁用 bypass 模式：

- `checkAndDisableBypassPermissionsIfNeeded()` — 启动时检查
- 如果 gate 触发 → 创建 `disabledBypassPermissionsContext`
- 类似机制适用于 auto mode

### 子任务/Agent 权限控制

Agent 类型通过多层机制限制权限：

1. **工具池过滤**：`getTools()` 根据 agent type 过滤可用工具
2. **运行时限制**：`ALL_AGENT_DISALLOWED_TOOLS` / `ASYNC_AGENT_ALLOWED_TOOLS` 等
3. **权限上下文隔离**：每个 agent 有独立的 `ToolPermissionContext`
4. **权限转发**：sub-agent 通过 mailbox 将 ask 决策转发给父 agent

---

## 十、设计原则

1. **最少权限原则** — 默认 ask 弹窗，需要用户显式配置 allow/deny
2. **分层防御** — deny rules → safety checks → mode → classifier，多层叠加
3. **bypass 免疫** — safety checks（.git/、.claude/）即使 bypass 模式也无法绕过
4. **最严格胜出** — Bash 子命令级决策合并，deny > ask > allow
5. **竞速优先** — 交互式弹窗使用 createResolveOnce atomic claim，多个批准路径竞争
6. **模式优先** — ToolPermissionContext.mode 在整个决策链中传递，影响每个阶段
7. **可审计** — PermissionDecisionReason 记录每个决策的完整原因链
