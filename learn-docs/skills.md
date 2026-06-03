# Claude Code Skills 技能系统源码分析

> 源码路径: `claude-code-source/src/`
> 分析日期: 2026-05-14

---

## 概述

Claude Code 的 Skills 系统管理所有"斜杠命令"（`/commit`、`/review-pr` 等）。核心架构分为三层：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Skills 系统整体架构                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 1: 存储层 — 技能来源                                       │    │
│  │                                                                 │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐    │    │
│  │  │ Bundled  │  │ Disk Skills  │  │ Plugin   │  │ MCP      │    │    │
│  │  │ (编译内置)│  │ .claude/skills│  │ Skills   │  │ Skills   │    │    │
│  │  └──────────┘  └──────────────┘  └──────────┘  └──────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 2: 注册层 — loadAllCommands()                             │    │
│  │                                                                 │    │
│  │  合并优先级: Bundled > Plugin > Disk > Workflow > CLI Commands   │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │ 最终: Command[] 数组                                      │    │    │
│  │  │ ┌ PromptCommand(skill) = markdown 展开                  │    │    │
│  │  │ ├ LocalCommand         = TypeScript call()              │    │    │
│  │  │ └ LocalJSXCommand      = Ink React 交互式 UI            │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 3: 执行层 — 两种调用路径                                   │    │
│  │                                                                 │    │
│  │  ┌──────────────────────┐      ┌─────────────────────────┐     │    │
│  │  │ 路径A: 用户斜杠命令   │      │ 路径B: 模型 Skill Tool  │     │    │
│  │  │ /commit → 直接展开   │      │ 模型调用 Skill("commit")│     │    │
│  │  │ 同步执行，模型回复    │      │ → validateInput → call │     │    │
│  │  └──────────────────────┘      └─────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Layer 4: 执行模式                                               │    │
│  │                                                                 │    │
│  │  inline (默认)    → 技能内容作为消息插入主对话                     │    │
│  │  fork             → 子 agent 独立执行，返回最终结果               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**核心文件清单**：

| 文件 | 作用 |
|------|------|
| `src/types/command.ts` | Command / PromptCommand 类型定义 |
| `src/commands.ts` | 命令注册中心：loadAllCommands()、findCommand() |
| `src/skills/loadSkillsDir.ts` | 磁盘技能加载、解析、动态发现、条件技能 |
| `src/skills/bundledSkills.ts` | 内置技能注册系统 |
| `src/skills/bundled/index.ts` | 15 个内置技能初始化 |
| `src/tools/SkillTool/SkillTool.ts` | Skill 工具定义（validation、permissions、call） |
| `src/tools/SkillTool/prompt.ts` | Skill 工具注入模型的 prompt（预算控制） |
| `src/tools/SkillTool/constants.ts` | `SKILL_TOOL_NAME = 'Skill'` |
| `src/utils/frontmatterParser.ts` | YAML frontmatter 解析 |
| `src/utils/processUserInput/processSlashCommand.tsx` | 斜杠命令处理入口 |
| `src/utils/processUserInput/processUserInput.ts` | 用户输入检测 `/` 前缀 |
| `src/utils/slashCommandParsing.ts` | 斜杠命令解析（name + args） |
| `src/utils/skills/skillChangeDetector.ts` | SKILL.md 文件变更热重载 |
| `src/utils/suggestions/skillUsageTracking.ts` | 技能使用频率追踪 |
| `src/utils/hooks/registerSkillHooks.ts` | 技能 hooks 注册 |
| `src/components/skills/SkillsMenu.tsx` | 技能选择菜单 UI |

---

## 一、核心类型定义

**路径**: `src/types/command.ts`

### Command 联合类型

```typescript
type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
```

一个技能具体是 `PromptCommand`：

```typescript
type PromptCommand = {
  type: 'prompt'
  progressMessage: string          // 执行时显示的进度消息
  contentLength: number            // 内容长度（token 估算用）
  argNames?: string[]              // 命名参数列表
  allowedTools?: string[]          // 允许模型使用的工具白名单
  model?: string                   // 模型覆盖（'opus' | 'haiku' | 'inherit'）
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  hooks?: HooksSettings            // 生命周期 hooks
  skillRoot?: string               // 技能资源文件基础目录
  context?: 'inline' | 'fork'      // 执行模式
  agent?: string                   // fork 模式的 agent 类型
  effort?: EffortValue             // 思考努力级别
  paths?: string[]                 // 条件激活的文件 glob 模式
  disableNonInteractive?: boolean
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}
```

### CommandBase 公共字段

```typescript
type CommandBase = {
  name: string
  description: string
  hasUserSpecifiedDescription?: boolean
  aliases?: string[]
  argumentHint?: string
  whenToUse?: string
  version?: string
  disableModelInvocation?: boolean       // true → 工具栏中隐藏
  userInvocable?: boolean                // false → 只能通过 Skill Tool 调用
  isEnabled?: boolean
  isHidden?: boolean
  immediate?: boolean
  loadedFrom: 'commands_DEPRECATED' | 'skills' | 'plugin' | 'managed' | 'bundled' | 'mcp'
  kind?: 'workflow'
  userFacingName?: () => string
}
```

### 另外两种 Command 类型

- **LocalCommand** (`type: 'local'`) — TypeScript 实现的命令，通过 `{ call: (args, context) => LocalCommandResult }` 执行（如 `/clear`、`/help`）
- **LocalJSXCommand** (`type: 'local-jsx'`) — Ink React 交互式 UI 命令（如 `/permissions`、`/config`）

### BundledSkillDefinition

**路径**: `src/skills/bundledSkills.ts`

```typescript
type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  files?: Record<string, string>          // 首次调用时提取到磁盘的引用文件
  getPromptForCommand(args, context): Promise<ContentBlockParam[]>
}
```

---

## 二、技能存储与加载

### 磁盘目录结构

```
.claude/skills/<skill-name>/SKILL.md          ← 标准格式（推荐）
.claude/commands/<command-name>.md            ← 旧版单文件格式（已弃用）
.claude/commands/<command-name>/SKILL.md      ← 旧版目录格式（已弃用）
```

### SKILL.md 文件格式

```markdown
---
name: my-skill
description: 我的自定义技能
aliases: [ms]
argument-hint: <file>
allowed-tools: [Read, Edit]
model: haiku
context: inline
when_to_use: 当用户需要……
---

# 技能内容

这里是技能的具体 markdown 内容……

## 使用说明

1. 第一步……
2. 第二步……
```

### 加载来源

**路径**: `src/skills/loadSkillsDir.ts` — `getSkillDirCommands()`（:638）

按优先级搜索以下目录：

1. **Managed（组织策略）**: `<managed-path>/.claude/skills/`
2. **User（用户级）**: `~/.claude/skills/`
3. **Project（项目级）**: 从 cwd 向上遍历，所有 `.claude/skills/`
4. **Additional（CLI 参数）**: `--add-dir` 标志指定的 `<dir>/.claude/skills/`
5. **Legacy**: `.claude/commands/` 目录（已弃用）

### 加载流程

```
loadSkillsFromSkillsDir(basePath, source)
  │
  ├── 1. readdir(basePath) — 列出所有子目录
  ├── 2. 对每个子目录 → 检查 SKILL.md 是否存在
  ├── 3. parseFrontmatter(content) — 解析 YAML frontmatter
  ├── 4. parseSkillFrontmatterFields(data) — 提取所有元数据
  │     ├── name / description / version
  │     ├── allowed-tools / argument-hint
  │     ├── model / disable-model-invocation
  │     ├── context / agent / effort
  │     ├── hooks / paths / shell
  │     └── user-invocable / hide-from-slash-command-tool
  ├── 5. createSkillCommand() — 构建 Command 对象
  │     └── 核心: getPromptForCommand 读取 SKILL.md 内容注入
  └── 6. 返回 Command[]
```

### 去重机制

**路径**: `src/skills/loadSkillsDir.ts`（:726-763）

使用 `realpath()` 解析 symlinks 来去重。优先级：Managed > User > Project > Additional > Legacy。

### 动态技能发现

当模型操作文件时，从文件路径向上遍历目录，发现隐含的 `.claude/skills/`：

```typescript
discoverSkillDirsForPaths(filePaths, cwd)
  │
  ├── 对每个文件路径: 从文件向 cwd 遍历
  ├── 检查每个目录下的 .claude/skills/
  ├── addSkillDirectories() — 加载新发现的技能
  └── 最深路径优先
```

### 条件技能（path-filtered）

Skills 的 `paths` frontmatter 字段指定 gitignore 风格的 glob 模式。只有模型操作匹配的文件时才会激活：

```typescript
activateConditionalSkillsForPaths(filePaths, cwd) → string[]
```

---

## 三、技能生命周期 — 完整调用链

### 路径 A: 用户斜杠命令

```
用户在输入框输入 /commit
  │
  ▼
processUserInput()
  │  src/utils/processUserInput/processUserInput.ts (:531)
  │
  ├── inputString.startsWith('/')? → 是
  │
  ▼
parseSlashCommand(inputString)
  │  src/utils/slashCommandParsing.ts
  │
  ├── 去掉前导 /
  ├── 按空格分割: commandName + args
  ├── 处理 MCP 格式: /serverName (MCP) arg
  │
  ▼
processSlashCommand(cmd, args, ...)
  │  src/utils/processUserInput/processSlashCommand.tsx (:309)
  │
  ├── hasCommand(cmd, allCommands)? → 是
  ├── userInvocable === false? → 拒绝，提示用 Skill Tool
  │
  ▼
getMessagesForSlashCommand(command, args)
  │  (同上 :525)
  │
  ├── command.type === 'prompt'? → 是（技能）
  │
  ├── context === 'fork'?
  │   ├── 是 → executeForkedSlashCommand() → sub-agent 执行
  │   └── 否 → getMessagesForPromptSlashCommand()
  │
  ▼
getMessagesForPromptSlashCommand(command, args)
  │  (同上 :827)
  │
  ├── 1. command.getPromptForCommand(args, context)
  │      → 读取 SKILL.md 内容 → 返回 ContentBlockParam[]
  ├── 2. registerSkillHooks(hooks) → 注册生命周期 hooks
  ├── 3. addInvokedSkill(name) → 记录技能调用（压缩时保留）
  ├── 4. 包装消息（加入 <command> XML 元数据标签）
  │
  ▼
返回 newMessages[] → 插入对话 → 模型回复
```

### 路径 B: 模型 Skill Tool

```
模型调用 Skill("commit", args:"--scope")
  │
  ▼
SkillTool.validateInput()
  │  src/tools/SkillTool/SkillTool.ts (:354)
  │
  ├── 去掉前导 /（兼容性）
  ├── findCommand(name) → 查找命令
  ├── disableModelInvocation === true? → 拒绝
  ├── command.type !== 'prompt'? → 拒绝
  │
  ▼
SkillTool.checkPermissions()
  │  (:432)
  │
  ├── allow/deny 规则匹配（支持前缀: review:*）
  ├── "安全属性" 白名单检查（SAFE_SKILL_PROPERTIES）
  └── 回退 → ask 用户
  │
  ▼
SkillTool.call()
  │  (:580)
  │
  ├── context === 'fork'
  │   ├── 是 → executeForkedSkill() → runAgent() 子 agent
  │   └── 否 → processPromptSlashCommand() → 展开消息
  │
  ▼
返回 newMessages[] + contextModifier(调整 allowedTools + model)
```

### Inline 执行模式（默认）

技能内容作为用户消息插入主对话，模型处理时能看到完整上下文。适合需要用户交互监督的技能。

### Fork 执行模式

技能在隔离的 sub-agent 中执行，独立的 token budget。返回最终结果：

- **同步**（用户斜杠命令）：等待完成，结果作为用户消息返回
- **异步**（Kairos assistant 模式）：fire-and-forget，完成后重新进入通知队列

---

## 四、Skill Tool 注入模型的 Prompt

**路径**: `src/tools/SkillTool/prompt.ts`

### 预算控制

Skill 列表注入受 `SKILL_BUDGET_CONTEXT_PERCENT`（1%）限制：

```typescript
const SKILL_BUDGET_CONTEXT_PERCENT = 0.01   // 上下文预算 1%
const DEFAULT_CHAR_BUDGET = 8000             // 最多 8000 字符
const MAX_LISTING_DESC_CHARS = 250           // 每条描述截断 250 字符
const CHARS_PER_TOKEN = 4                    // 字符/token 估算比
```

### Prompt 注入内容

```xml
<skills>
<skill name="commit" description="Commit changes to git..." argumentHint="<message>">
  <whenToUse>When you need to stage and commit changes</whenToUse>
</skill>
<skill name="review-pr" description="Review a GitHub pull request..." argumentHint="<url>">
  <whenToUse>When reviewing PRs before merging</whenToUse>
</skill>
...
</skills>
```

`formatCommandsWithinBudget()` 函数：

```
    总字符预算 / (描述长度 + 开销)
        │
        ▼
    根据使用频率排序（7 天半衰期）
        │
        ▼
    截断：最多展示到预算上限
```

### 系统 Prompt 关联

**路径**: `src/constants/prompts.ts`（:382）

```markdown
/<skill-name> (e.g., /commit) is shorthand for users to invoke a user-invocable skill.
When executed, the skill gets expanded to a full prompt. Use the Skill tool to execute them.
```

---

## 五、Frontmatter 解析器

**路径**: `src/utils/frontmatterParser.ts`

### 正则

```typescript
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/
```

提取两个 `---` 分隔符之间的 YAML 块。

### 支持的全部字段

| Frontmatter 字段 | Command 属性 | 类型 | 说明 |
|-----------------|-------------|------|------|
| `name` | name | string | 显示名覆盖 |
| `description` | description | string | 单行摘要（回退到首行 markdown） |
| `aliases` | aliases | string[] | 别名 |
| `argument-hint` | argumentHint | string | 参数占位符提示 |
| `arguments` | — | object | 命名参数定义 |
| `when_to_use` | whenToUse | string | 模型自动调用提示 |
| `version` | version | string | 版本号 |
| `allowed-tools` | allowedTools | string[] | 工具权限白名单 |
| `model` | model | string | 模型覆盖（opus/haiku/inherit） |
| `disable-model-invocation` | disableModelInvocation | boolean | 禁止模型通过 SkillTool 调用 |
| `user-invocable` | userInvocable | boolean | 是否可通过 `/name` 调用 |
| `context` | context | 'inline' \| 'fork' | 执行模式 |
| `agent` | agent | string | fork 模式 agent 类型 |
| `effort` | effort | EffortValue | 思考努力级别 |
| `paths` | paths | string[] | 条件激活 glob 模式 |
| `hooks` | hooks | HooksSettings | 生命周期 hooks |
| `shell` | — | 'bash' \| 'powershell' | `!`-block 执行 shell |
| `hide-from-slash-command-tool` | isHidden | boolean | 在工具菜单中隐藏 |

### YAML 错误恢复

如果 YAML 解析失败，自动用引号包裹 glob 模式等特殊字符后重试。例如 `**/*.{ts,tsx}` 在 YAML 中需要引号。

---

## 六、内置技能（Bundled Skills）

**路径**: `src/skills/bundled/index.ts`

`initBundledSkills()` 在启动时注册 15 个内置技能：

| 技能名 | 命令 | 说明 |
|--------|------|------|
| update-config | `/update-config` | 更新 Claude Code 配置 |
| keybindings | `/keybindings` | 键盘快捷键 |
| verify | `/verify` | 验证项目配置 |
| debug | `/debug` | 调试信息 |
| lorem-ipsum | `/lorem-ipsum` | 生成 Lorem Ipsum 文本 |
| skillify | `/skillify` | 从当前会话生成 SKILL.md |
| remember | `/remember` | 保存记忆 |
| simplify | `/simplify` | 简化代码 |
| batch | `/batch` | 批量操作 |
| stuck | `/stuck` | 卡住时获得建议 |
| loop | `/loop` | 循环执行 |
| schedule-remote-agents | `/schedule-remote-agents` | 调度远程 agent |
| claude-api | `/claude-api` | Claude API 配置 |
| claude-in-chrome | `/claude-in-chrome` | Chrome 集成 |
| run-skill-generator | `/run-skill-generator` | 运行技能生成器 |

### 内置技能注册流程

```typescript
registerBundledSkill(definition: BundledSkillDefinition)
  │
  ├── 1. 转换 definition → Command 对象
  ├── 2. 处理 files（首次调用的引用文件提取）
  │     写入 temp dir
  │     prependBaseDir() → 内容前加 "Base directory for this skill: <path>"
  ├── 3. 加入 bundledSkills[] 数组
  └── 4. initBundledSkills → 调用 registerBundledSkill 15 次
```

---

## 七、命令注册中心 — `commands.ts`

**路径**: `src/commands.ts`

### `loadAllCommands()` — 合并优先级

```typescript
return [
  ...bundledSkills,         // 编译内置，最高优先级
  ...builtinPluginSkills,   // 内置插件
  ...skillDirCommands,      // 磁盘 .claude/skills/
  ...workflowCommands,      // 工作流脚本
  ...pluginCommands,        // 安装的插件
  ...pluginSkills,          // MCP + 插件技能
  ...COMMANDS(),            // 内置 CLI 命令 (/help, /clear 等)
]
```

### `findCommand()` — 查找逻辑

先匹配 name，再匹配 aliases，首个匹配获胜。

### `getSkillToolCommands()` — Skill 工具可见的命令

返回所有 `type === 'prompt'` 且 `disableModelInvocation !== true` 且 `source !== 'builtin'` 的 command。

### `getSlashCommandToolSkills()` — 斜杠命令可见的技能

在 `getSkillToolCommands()` 基础上进一步过滤（仅返回真正的 skill，不包含其他 prompt command）。

---

## 八、技能与命令的演进

代码库从"commands"模型演进到"skills"模型：

| 维度 | Commands (旧) | Skills (新) |
|------|---------------|-------------|
| **目录** | `.claude/commands/` | `.claude/skills/` |
| **格式** | 单文件 `.md` 或目录格式 | 仅目录格式 `name/SKILL.md` |
| **loadedFrom** | `'commands_DEPRECATED'` | `'skills'` |
| **状态** | 已弃用 | 当前推荐 |
| **userInvocable** | 默认 true | 默认 true |

内置 CLI 命令（`/help`、`/clear`、`/config`、`/commit`）仍然是 `LocalCommand`/`LocalJSXCommand` 类型，有完整的 TypeScript 实现，不是 markdown 技能。

---

## 九、热重载机制

**路径**: `src/utils/skills/skillChangeDetector.ts`

使用 Chokidar 监听技能目录变更：

```typescript
skillChangeDetector.watch(skillDirs, () => {
  // SKILL.md 添加/修改/删除
  clearCache()      // 清除加载缓存
  reloadCommands()  // 重新加载所有命令
})
```

React 侧通过 `useSkillsChange` hook（`src/hooks/useSkillsChange.ts`）订阅变更事件和 GrowthBook 刷新。

---

## 十、设计原则

1. **内容驱动** — 技能本质是 markdown 内容（`PromptCommand`），代码量最小的执行路径是"读文件 + 注入 prompt"
2. **双层调用** — 用户通过 `/name` 直接调用，模型通过 Skill Tool 间接调用，最终都走到 `getPromptForCommand()`
3. **两级作用域** — `inline` 模式共享主对话上下文，`fork` 模式隔离执行，适合长任务
4. **上下文预算控制** — Skill 列表注入限制为 1% 上下文窗口，使用频率排序确保最常用的技能优先展示
5. **文件即配置** — 一个 `SKILL.md` 文件就是一个技能，目录即名称，命名空间天然支持
6. **热点加载** — 磁盘技能只在文件变更时重新加载（Chokidar 监听），运行时无磁盘 I/O
7. **优先级分层** — Bundled > Plugin > Disk > Workflow > CLI Commands，同名覆盖由优先级决定
8. **自动发现** — 从文件路径向上遍历 `.claude/skills/`，子目录技能自动可见
9. **条件激活** — `paths` glob 模式确保技能只在与相关文件交互时才出现在 prompt 中
10. **工具化** — Skill 是工具系统的成员，遵循完整的 permission 决策链（allow/deny/ask + 前缀匹配）
