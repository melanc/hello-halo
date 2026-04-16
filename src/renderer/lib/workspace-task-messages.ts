/**
 * Composer reference labels and agent prompts for workspace task workflows.
 */

import type { TFunction } from 'i18next'
import type { PipelineStage, PipelineSubtask, WorkspaceTask } from '../types'

const DOC_EXCERPT_LEN = 600
const DESC_EXCERPT_LEN = 400
const REQ_IDENTIFY_LEN = 3000
const DEV_PLAN_EXCERPT_LEN = 12_000

/** Top-level project directory names attached to the task (planned + touched). */
export function getInvolvedProjectDirNames(task: WorkspaceTask): string[] {
  return Array.from(new Set([...(task.projectDirs ?? []), ...(task.touchedProjectDirs ?? [])])).filter(Boolean)
}

/** Best-effort absolute-style paths for prompts (workspace root + each first-level dir). */
export function buildProjectDisplayPaths(workspaceRoot: string, dirNames: string[]): string[] {
  const root = workspaceRoot.trim()
  if (!root) return dirNames
  const sep = root.includes('\\') ? '\\' : '/'
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  return dirNames.map((d) => `${normalizedRoot}${sep}${d.replace(/^[\\/]+/, '')}`)
}

/** Tab 4 — require saved dev plan text, at least one project dir, and a non-empty branch. */
export function evaluateCodingPrereqs(task: WorkspaceTask, t: TFunction): { ok: boolean; message: string } {
  const plan = task.pipelineDevPlan?.trim() ?? ''
  if (!plan) {
    return {
      ok: false,
      message: t('编码前请先在标签 3 完成开发计划与代码范围。'),
    }
  }
  const dirs = getInvolvedProjectDirNames(task)
  const branch = task.branchName?.trim() ?? ''
  if (dirs.length === 0 || !branch) {
    return {
      ok: false,
      message: t('请先在标签 3 设置至少一个涉及项目和开发分支，确认后再开始编码。'),
    }
  }
  return { ok: true, message: '' }
}

/**
 * Linear pipeline: tab N may only run after tab N−1 is ready.
 * Use before Intent / Start work (combined with per-tab checks in getTabCheck).
 */
export function assertPreviousPipelineStepReady(
  tab: PipelineStage,
  task: WorkspaceTask,
  subtasks: PipelineSubtask[],
  t: TFunction
): { ok: true } | { ok: false; message: string } {
  if (tab <= 1) return { ok: true }

  if (tab === 2) {
    if (!task.requirementAnalysis?.trim()) {
      return {
        ok: false,
        message: t(
          'Finish requirement identification on tab 1 first: run Start work to generate requirement analysis, or paste the analysis text, then continue.'
        ),
      }
    }
    return { ok: true }
  }

  if (tab === 3) {
    const titled = subtasks.filter((s) => s.title.trim().length > 0)
    if (titled.length === 0) {
      return {
        ok: false,
        message: t(
          'Finish task breakdown on tab 2 first: generate subtasks with titles (or add them manually), then continue.'
        ),
      }
    }
    return { ok: true }
  }

  if (tab === 4) {
    if (!task.pipelineDevPlan?.trim()) {
      return {
        ok: false,
        message: t(
          'Finish development planning on tab 3 first: save a development plan (use Start work or edit the plan text), then continue.'
        ),
      }
    }
    return { ok: true }
  }

  if (tab === 5) {
    const st = task.pipelineStage ?? 1
    if (st < 4) {
      return {
        ok: false,
        message: t(
          'Finish coding on tab 4 first: run Start work there at least once so the pipeline reaches the coding stage, then continue to verification.'
        ),
      }
    }
    return { ok: true }
  }

  return { ok: true }
}

/** Derive done / next / allDone from pipeline subtask statuses (user-updated in the task panel). */
export function getSubtaskProgressStats(subtasks: PipelineSubtask[] | undefined) {
  const list = subtasks ?? []
  const doneList = list.filter((s) => s.status === 'done')
  const pendingList = list.filter((s) => s.status === 'pending')
  const inProgressList = list.filter((s) => s.status === 'in_progress')
  const allDone = list.length > 0 && list.every((s) => s.status === 'done')
  const nextSubtask = inProgressList[0] ?? pendingList[0] ?? null
  return {
    total: list.length,
    doneCount: doneList.length,
    allDone,
    nextSubtask,
    doneList,
    pendingList,
    inProgressList,
  }
}

/** Human-readable block for prompts: subtasks grouped by status (source of truth for “what is done”). */
export function formatSubtasksProgressForPrompt(subtasks: PipelineSubtask[] | undefined, t: TFunction): string {
  const list = subtasks ?? []
  if (!list.length) {
    return t(
      'There are no breakdown subtasks on record; infer progress only from the development plan and conversation.'
    )
  }
  const lines: string[] = []
  const { doneCount, total } = getSubtaskProgressStats(list)
  lines.push(
    t('Subtask board: {{done}} / {{total}} marked done (pending and in_progress are not done).', {
      done: doneCount,
      total,
    })
  )
  const appendGroup = (heading: string, items: PipelineSubtask[]) => {
    if (!items.length) return
    lines.push('', heading)
    items.forEach((s) =>
      lines.push(`- [${s.status}] ${s.title}${s.description ? ' — ' + s.description : ''}`)
    )
  }
  appendGroup(t('Completed:'), list.filter((s) => s.status === 'done'))
  appendGroup(t('In progress:'), list.filter((s) => s.status === 'in_progress'))
  appendGroup(t('Pending:'), list.filter((s) => s.status === 'pending'))
  return lines.join('\n')
}

/**
 * Shared role preamble prepended to every task-pipeline message.
 * Gives the AI a consistent identity and scope for the entire workflow.
 */
const ROLE_PREAMBLE =
  '你是一名软件需求开发工程师，你的职责是：识别和分析需求、拆解开发任务、生成开发计划、指导代码实现。'

/** Prefer Chinese model replies in task-pipeline messages (English i18n key per project rules). */
function replyLanguageConstraint(t: TFunction): string {
  return t(
    'Please respond mainly in Simplified Chinese except inside code blocks, file paths, identifiers, and unavoidable English technical terms.'
  )
}

/** Role line + language preference, inserted at the start of pipeline prompts. */
function pipelineOpeningLines(t: TFunction): string[] {
  return [ROLE_PREAMBLE, '', replyLanguageConstraint(t), '']
}

function appendKnowledgeBaseMarkdownBlock(blocks: string[], markdown: string | undefined, t: TFunction): void {
  const m = markdown?.trim()
  if (!m) return
  blocks.push(
    '',
    t('--- Linked knowledge base (Markdown excerpts, for business/architecture context) ---'),
    '',
    m
  )
}

/**
 * Message that asks the AI to identify and analyse requirements from the uploaded doc / description.
 * The full doc content (up to REQ_IDENTIFY_LEN chars) is included so the AI can extract key points.
 */
export function buildRequirementIdentifyMessage(
  task: WorkspaceTask,
  t: TFunction,
  opts?: { knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
  ]

  // If a knowledge base path is provided, ask the AI to actively explore it first
  if (opts?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在开始识别需求之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
      t('2. 找到需求识别引导文件（文件名通常包含"需求识别"、"requirement"、"guide"等关键词），阅读其内容'),
      t('3. 按照该引导文件的规范，对以下需求进行识别和分析'),
      t('如果找不到引导文件，按通用需求分析方法处理。'),
      '',
    )
  }

  blocks.push(
    t('请识别并分析以下需求，输出结构化的需求要点。'),
    '',
    t('任务名称：{{name}}', { name: task.name }),
  )

  if (task.requirementDocName?.trim()) {
    blocks.push(t('需求文档：{{name}}', { name: task.requirementDocName.trim() }))
  }

  const content = task.requirementDocContent?.trim() || task.requirementDescription?.trim()
  if (content) {
    blocks.push('', t('需求内容：'), content.slice(0, REQ_IDENTIFY_LEN))
  }

  // Only append pre-loaded KB markdown if no root path was given (fallback)
  if (!opts?.knowledgeBaseRoot?.trim()) {
    appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  }

  blocks.push(
    '',
    t('请按以下结构输出：'),
    t('1. 需求背景与目标'),
    t('2. 核心功能要点（逐条列出，每条一行，以 - 开头）'),
    t('3. 涉及的系统模块或技术范围'),
    t('4. 注意事项或潜在风险'),
  )

  return blocks.join('\n')
}

/**
 * 意图识别 — per-tab planning message.
 * Asks the AI to describe what it plans to do for this pipeline step,
 * and to surface any questions or ambiguities before execution.
 */
export function buildIntentAnalysisMessage(
  tab: PipelineStage,
  task: WorkspaceTask,
  opts: {
    subtasks?: PipelineSubtask[]
    keyPoints?: string[]
    codingWorkspaceRoot?: string
    codingProjectPaths?: string[]
    knowledgeBaseMarkdown?: string
  },
  t: TFunction
): string {
  const header = `任务名称：${task.name}`

  switch (tab) {
    case 1: {
      const blocks = [
        ...pipelineOpeningLines(t),
        t('请分析以下需求，告诉我：'),
        t('1. 你理解到的需求背景和目标是什么'),
        t('2. 你打算提取哪些核心功能要点'),
        t('3. 有哪些地方不清楚，需要进一步确认'),
        '',
        header,
      ]
      if (task.requirementDocName?.trim()) {
        blocks.push(`需求文档：${task.requirementDocName.trim()}`)
      }
      const content = task.requirementDocContent?.trim() || task.requirementDescription?.trim()
      if (content) blocks.push('', '需求内容：', content.slice(0, REQ_IDENTIFY_LEN))
      appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      return blocks.join('\n')
    }
    case 2: {
      const blocks = [
        ...pipelineOpeningLines(t),
        t('请根据以下需求要点，列出你的任务拆解方案：'),
        t('1. 打算拆分哪些子任务，每个子任务的目标是什么'),
        t('2. 子任务之间的依赖关系和执行顺序'),
        t('3. 有哪些不确定的地方需要先确认'),
        '',
        header,
      ]
      if (opts.keyPoints?.length) {
        blocks.push('', '需求要点：')
        opts.keyPoints.forEach((pt) => blocks.push(`- ${pt}`))
      } else {
        const content = task.requirementDocContent?.trim() || task.requirementDescription?.trim()
        if (content) blocks.push('', '需求内容：', content.slice(0, REQ_IDENTIFY_LEN))
      }
      appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      return blocks.join('\n')
    }
    case 3: {
      const blocks = [
        ...pipelineOpeningLines(t),
        t('请根据以下子任务列表，说明你的开发计划：'),
        t('1. 涉及哪些项目 / 代码模块'),
        t('2. 主要代码改动范围和实现思路'),
        t('3. 有哪些需要用户确认或存在风险的地方'),
        '',
        header,
      ]
      if (opts.subtasks?.length) {
        blocks.push('', '子任务列表：')
        opts.subtasks.forEach((st) => blocks.push(`- ${st.title}${st.description ? '：' + st.description : ''}`))
      }
      appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      return blocks.join('\n')
    }
    case 4: {
      const blocks = [
        ...pipelineOpeningLines(t),
        t('Review the development plan and the recorded subtask completion status, then judge what is left to do.'),
        t('1. Verdict vs plan: finished or not; gaps between plan bullets and done subtasks'),
        t('2. If work remains: ordered next steps and concrete files or modules to touch'),
        t('3. Risks or questions before any edits'),
        '',
        header,
      ]
      const plan = task.pipelineDevPlan?.trim()
      if (plan) {
        blocks.push('', t('Development plan (must follow):'), plan.slice(0, DEV_PLAN_EXCERPT_LEN))
      }
      if (task.branchName?.trim()) {
        blocks.push('', t('Development branch: {{branch}}', { branch: task.branchName.trim() }))
      }
      if (opts.codingWorkspaceRoot?.trim()) {
        blocks.push('', t('Workspace root path: {{path}}', { path: opts.codingWorkspaceRoot.trim() }))
      }
      if (opts.codingProjectPaths?.length) {
        blocks.push('', t('Involved project paths (top-level folders under workspace):'))
        opts.codingProjectPaths.forEach((p) => blocks.push(`- ${p}`))
      } else if (getInvolvedProjectDirNames(task).length) {
        blocks.push('', t('Involved project folders (relative names):'))
        getInvolvedProjectDirNames(task).forEach((d) => blocks.push(`- ${d}`))
      }
      blocks.push('', t('--- Subtask completion record (source of truth) ---'))
      blocks.push(formatSubtasksProgressForPrompt(opts.subtasks, t))
      blocks.push(
        '',
        t('Compare the development plan with the subtask completion record above.'),
        t('Your reply must include:'),
        t('• A clear verdict: all work complete / not complete, relative to both the plan and subtask statuses.'),
        t(
          '• If not complete: numbered “Next steps” that name specific pending or in-progress subtasks or plan sections still to implement.'
        ),
        t('• If you believe everything is done: say so and suggest what to verify (tests, manual checks) before closing.'),
        t('• Call out any plan bullet not covered by a subtask, or any done subtask that still leaves a plan gap.'),
        '',
        t('Then output a concise “planned changes” section for the immediate next coding slice — do not modify files yet.')
      )
      appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      return blocks.join('\n')
    }
    case 5: {
      const blocks = [
        ...pipelineOpeningLines(t),
        t('请说明你的验证收尾计划：'),
        t('1. 要检查哪些代码逻辑和边界情况'),
        t('2. 要运行哪些测试'),
        t('3. 有哪些已知风险点'),
        '',
        header,
      ]
      appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      return blocks.join('\n')
    }
    default:
      return header
  }
}

/**
 * 开始工作 Tab 2 — asks AI to output the final task breakdown list for parsing.
 * Must be called after 意图识别 so the AI already has context from the conversation.
 */
export function buildTaskBreakdownExecuteMessage(
  t: TFunction,
  opts?: { knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string }
): string {
  const blocks = [
    ...pipelineOpeningLines(t),
  ]

  if (opts?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在生成任务拆解之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
      t('2. 找到任务拆解引导文件（文件名通常包含"任务拆解"、"task-breakdown"、"breakdown"等关键词），阅读其内容'),
      t('3. 按照该引导文件的规范生成子任务列表'),
      t('如果找不到引导文件，按通用方法处理。'),
      '',
    )
  }

  blocks.push(
    t('请按照我们刚才讨论的方案，输出任务拆解结果。'),
    t('格式要求：按"要做的事"分类分组，每个分组以 ## 开头写分组名称；分组下每个子任务单独一行以 - 开头，格式为「- 子任务标题 (涉及项目1, 涉及项目2): 简要说明」，括号中填写该子任务会改动哪些项目名称。'),
    t('示例：'),
    t('## 修复编译问题'),
    t('- 修复 gently handler 的 import (talcamp): 补全缺失的包引用'),
    t('- 修复 ZK 注册服务名 (vote-service, duration-service): 改为正确的服务名'),
    t('## 移除旧逻辑'),
    t('- 移除 plog 埋点 (talcamp): 删除 plog 相关代码及 import'),
    t('不需要其他说明，直接输出分组子任务列表。'),
  )

  if (!opts?.knowledgeBaseRoot?.trim()) {
    appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  }

  return blocks.join('\n')
}

/**
 * 开始工作 Tab 3 — asks AI to output the final dev plan text for saving.
 */
export function buildDevPlanExecuteMessage(
  t: TFunction,
  opts?: { knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string }
): string {
  const blocks = [
    ...pipelineOpeningLines(t),
  ]

  if (opts?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在生成开发计划之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
      t('2. 找到开发计划引导文件（文件名通常包含"开发计划"、"dev-plan"、"planning"等关键词），阅读其内容'),
      t('3. 按照该引导文件的规范生成开发计划'),
      t('如果找不到引导文件，按通用方法处理。'),
      '',
    )
  }

  blocks.push(
    t('请按照我们刚才讨论的方案，输出最终的开发计划，分两个部分：'),
    '',
    t('第一部分 — 各项目改动点：'),
    t('以 "## 各项目改动点" 作为标题，然后对每个涉及的项目用 ### 项目名 作为子标题，下面列出该项目的具体改动点（每条以 - 开头）。'),
    t('示例：'),
    t('## 各项目改动点'),
    t('### talcamp'),
    t('- 修复 gently handler 中的 import 引用'),
    t('- 移除 plog 埋点相关代码'),
    t('### vote-service'),
    t('- 修正 ZK 注册服务名'),
    '',
    t('第二部分 — 整体改动说明：'),
    t('以 "## 整体改动说明" 作为标题，用自然语言描述整体代码改动范围和注意事项。'),
    '',
    t('只输出这两部分内容，不需要其他说明。'),
  )

  if (!opts?.knowledgeBaseRoot?.trim()) {
    appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  }

  return blocks.join('\n')
}

/**
 * 开始工作 Tab 4 — kicks off the actual coding phase.
 * Includes the dev plan so the AI has full context to start implementing.
 */
export function buildCodingKickoffMessage(
  task: WorkspaceTask,
  t: TFunction,
  ctx?: { workspaceRoot?: string; projectPaths?: string[]; knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
  ]

  if (ctx?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在开始编码之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: ctx.knowledgeBaseRoot.trim() }),
      t('2. 找到编码实现引导文件（文件名通常包含"编码"、"coding"、"implementation"等关键词），阅读其内容'),
      t('3. 按照该引导文件的编码规范进行代码实现'),
      t('如果找不到引导文件，按通用编码规范处理。'),
      '',
    )
  }

  blocks.push(
    t('现在进入编码实现阶段。请根据以下开发计划，开始逐步执行代码改动。'),
    t('执行要求：'),
    t('1. 按照开发计划中的模块和文件范围进行修改'),
    t('2. 每完成一个模块或文件，简要说明改动内容'),
    t('3. 遇到不确定的地方，先列出问题再继续'),
    '',
    t('任务名称：{{name}}', { name: task.name }),
  )

  if (task.branchName?.trim()) {
    blocks.push('', t('Development branch: {{branch}}', { branch: task.branchName.trim() }))
  }
  if (ctx?.workspaceRoot?.trim()) {
    blocks.push('', t('Workspace root path: {{path}}', { path: ctx.workspaceRoot.trim() }))
  }
  if (ctx?.projectPaths?.length) {
    blocks.push('', t('Involved project paths (work only inside these unless the plan says otherwise):'))
    ctx.projectPaths.forEach((p) => blocks.push(`- ${p}`))
  }

  if (task.pipelineDevPlan?.trim()) {
    blocks.push('', t('开发计划：'), task.pipelineDevPlan.trim().slice(0, DEV_PLAN_EXCERPT_LEN))
  } else if (task.pipelineSubtasks?.length) {
    blocks.push('', t('子任务列表：'))
    task.pipelineSubtasks.forEach((st) =>
      blocks.push(`- ${st.title}${st.description ? '：' + st.description : ''}`)
    )
  }

  const sts = task.pipelineSubtasks ?? []
  blocks.push('', t('--- Subtask completion record (user marks done in task panel) ---'))
  blocks.push(formatSubtasksProgressForPrompt(sts, t))
  blocks.push(
    '',
    t('Use the development plan together with this completion record.'),
    t('Implement remaining work first (pending / in_progress subtasks and any plan gaps).'),
    t('If every subtask is already marked done, confirm against the plan; only fix residual gaps or run checks.'),
    t('After substantive edits, remind the user to update subtask checkmarks so the next Intent / Start work stays accurate.')
  )

  // Only append pre-loaded KB markdown if no root path was given (fallback)
  if (!ctx?.knowledgeBaseRoot?.trim()) {
    appendKnowledgeBaseMarkdownBlock(blocks, ctx?.knowledgeBaseMarkdown, t)
  }

  return blocks.join('\n')
}

/**
 * 开始工作 Tab 5 — writes task completion conclusions to the space memory file.
 * The AI reads the existing memory file, then appends a structured History entry.
 */
export function buildTaskCompletionMemoryMessage(
  task: WorkspaceTask,
  t: TFunction,
  ctx: { spaceMemoryPath: string }
): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 13) // e.g. 20260416-1430

  const blocks: string[] = [
    ...pipelineOpeningLines(t),
    t('本次任务已完成验收。请将以下任务结论写入空间记忆文件，供后续任务参考。'),
    '',
    t('记忆文件路径：{{path}}', { path: ctx.spaceMemoryPath }),
    '',
    t('操作步骤：'),
    t('1. 使用 Read 工具读取记忆文件，了解现有格式和内容'),
    t('2. 在 `# History` 区块的最顶部插入一条新记录，格式如下：'),
    '',
    '```',
    `## ${ts} | ${task.name}`,
    t('### 需求摘要'),
    t('（填入核心功能要点）'),
    '',
    t('### 子任务'),
    t('（填入子任务列表及完成状态）'),
    '',
    t('### 开发计划要点'),
    t('（填入涉及项目、主要改动范围）'),
    '',
    t('### 经验教训'),
    t('（填入本次开发中遇到的问题和解决方案，无则留空）'),
    '```',
    '',
    t('3. 使用 Edit 或 Write 工具将新记录写入文件，不要修改 `# now` 区块的其他内容'),
    t('4. 写入完成后，简要告知用户已记录哪些内容'),
    '',
    t('--- 任务信息 ---'),
    t('任务名称：{{name}}', { name: task.name }),
  ]

  if (task.requirementKeyPoints?.length) {
    blocks.push('', t('需求要点：'))
    task.requirementKeyPoints.forEach((p) => blocks.push(`- ${p}`))
  } else if (task.requirementAnalysis?.trim()) {
    blocks.push('', t('需求分析：'), task.requirementAnalysis.trim().slice(0, 800))
  }

  if (task.pipelineSubtasks?.length) {
    blocks.push('', t('子任务列表：'))
    task.pipelineSubtasks.forEach((st) =>
      blocks.push(`- [${st.status}] ${st.title}${st.description ? '：' + st.description : ''}`)
    )
  }

  if (task.pipelineDevPlan?.trim()) {
    blocks.push('', t('开发计划：'), task.pipelineDevPlan.trim().slice(0, 1200))
  }

  return blocks.join('\n')
}

/** Multiline label prepended as a composer reference chip (sent as first block of the user message). */
export function buildWorkspaceTaskComposerReferenceLabel(task: WorkspaceTask, t: TFunction): string {
  const lines: string[] = []
  lines.push(t('Workspace task reference: {{name}}', { name: task.name }))
  if (task.requirementDocName?.trim()) {
    lines.push(t('Attached requirement document: {{name}}', { name: task.requirementDocName.trim() }))
  }
  if (task.requirementDescription?.trim()) {
    const text = task.requirementDescription.trim().slice(0, DESC_EXCERPT_LEN)
    lines.push(t('Requirement description excerpt: {{text}}', { text }))
  } else if (task.requirementDocContent?.trim()) {
    const text = task.requirementDocContent.trim().slice(0, DOC_EXCERPT_LEN)
    lines.push(t('Requirement document excerpt: {{text}}', { text }))
  }
  lines.push('')
  lines.push(t('I am adding supplements or clarifications below for this task.'))
  lines.push('', replyLanguageConstraint(t))
  return lines.join('\n')
}

/** User message that asks the agent for a review-only implementation plan first. */
export function buildImplementationPlanKickoffMessage(task: WorkspaceTask, t: TFunction): string {
  const blocks: string[] = [
    replyLanguageConstraint(t),
    '',
    t('Start the implementation workflow for this workspace task.'),
    t(
      'Phase 1: Output an implementation plan only (Markdown): goals, scope, files or modules to touch, risks, testing notes, and ordered steps.'
    ),
    t(
      'Do not use tools that modify the codebase (no writes/patches) until I explicitly approve (for example by replying with confirm or OK).'
    ),
    '',
    t('Task name: {{name}}', { name: task.name }),
  ]
  if (task.requirementDocName?.trim()) {
    blocks.push(t('Requirement document: {{name}}', { name: task.requirementDocName.trim() }))
  }
  if (task.requirementDescription?.trim()) {
    blocks.push(
      t('Requirement description:\n{{text}}', { text: task.requirementDescription.trim().slice(0, DOC_EXCERPT_LEN) })
    )
  } else if (task.requirementDocContent?.trim()) {
    blocks.push(
      t('Requirement document excerpt:\n{{text}}', { text: task.requirementDocContent.trim().slice(0, DOC_EXCERPT_LEN) })
    )
  }
  blocks.push(
    '',
    t('After I review and confirm the plan, proceed to Phase 2: apply the plan and implement the code changes.')
  )
  return blocks.join('\n')
}

export interface BreakdownSubTaskRef {
  title: string
  detail: string
}

/** Composer chip for a single breakdown sub-task (supplement / clarify flow). */
export function buildSubTaskComposerReferenceLabel(
  task: WorkspaceTask,
  sub: BreakdownSubTaskRef,
  t: TFunction
): string {
  const lines: string[] = []
  lines.push(t('Workspace task reference: {{name}}', { name: task.name }))
  const subTitle = sub.title?.trim()
  if (subTitle) {
    lines.push(t('Breakdown sub-task: {{title}}', { title: subTitle }))
  }
  if (sub.detail?.trim()) {
    const text = sub.detail.trim().slice(0, DESC_EXCERPT_LEN)
    lines.push(t('Sub-task detail excerpt: {{text}}', { text }))
  } else if (task.requirementDescription?.trim()) {
    const text = task.requirementDescription.trim().slice(0, DESC_EXCERPT_LEN)
    lines.push(t('Requirement description excerpt: {{text}}', { text }))
  } else if (task.requirementDocContent?.trim()) {
    const text = task.requirementDocContent.trim().slice(0, DOC_EXCERPT_LEN)
    lines.push(t('Requirement document excerpt: {{text}}', { text }))
  }
  lines.push('')
  lines.push(t('I am adding supplements or clarifications below for this task.'))
  lines.push('', replyLanguageConstraint(t))
  return lines.join('\n')
}

/** Plan-first kickoff scoped to one breakdown sub-task. */
export function buildSubTaskImplementationPlanKickoffMessage(
  task: WorkspaceTask,
  sub: BreakdownSubTaskRef,
  t: TFunction
): string {
  const subTitle = sub.title?.trim() || t('Full breakdown')
  const blocks: string[] = [
    replyLanguageConstraint(t),
    '',
    t('Start the implementation workflow for this workspace task.'),
    t(
      'Scope: implement only the following breakdown sub-task unless I explicitly ask to expand scope.'
    ),
    t(
      'Phase 1: Output an implementation plan only (Markdown): goals, scope, projects or packages to touch, public interfaces to change or add, concrete files or code areas, risks, testing notes, and ordered steps.'
    ),
    t(
      'Do not use tools that modify the codebase (no writes/patches) until I explicitly approve (for example by replying with confirm or OK).'
    ),
    '',
    t('Workspace task name: {{name}}', { name: task.name }),
    t('Breakdown sub-task title: {{title}}', { title: subTitle }),
  ]
  if (sub.detail?.trim()) {
    blocks.push(
      t('Breakdown sub-task detail:\n{{text}}', { text: sub.detail.trim().slice(0, DOC_EXCERPT_LEN) })
    )
  }
  if (task.requirementDocName?.trim()) {
    blocks.push(t('Requirement document: {{name}}', { name: task.requirementDocName.trim() }))
  }
  if (task.requirementDescription?.trim()) {
    blocks.push(
      t('Requirement description:\n{{text}}', { text: task.requirementDescription.trim().slice(0, DOC_EXCERPT_LEN) })
    )
  } else if (task.requirementDocContent?.trim()) {
    blocks.push(
      t('Requirement document excerpt:\n{{text}}', { text: task.requirementDocContent.trim().slice(0, DOC_EXCERPT_LEN) })
    )
  }
  blocks.push(
    '',
    t('After I review and confirm the plan, proceed to Phase 2: apply the plan and implement the code changes.')
  )
  return blocks.filter(Boolean).join('\n')
}
