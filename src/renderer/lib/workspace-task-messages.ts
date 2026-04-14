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
      message: t('Complete the development plan and code scope on tab 3 before coding.'),
    }
  }
  const dirs = getInvolvedProjectDirNames(task)
  const branch = task.branchName?.trim() ?? ''
  if (dirs.length === 0 || !branch) {
    return {
      ok: false,
      message: t(
        'Set at least one involved project and the development branch on tab 3, then confirm before coding.'
      ),
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
  opts?: { knowledgeBaseMarkdown?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
    t('请识别并分析以下需求，输出结构化的需求要点。'),
    '',
    t('任务名称：{{name}}', { name: task.name }),
  ]

  if (task.requirementDocName?.trim()) {
    blocks.push(t('需求文档：{{name}}', { name: task.requirementDocName.trim() }))
  }

  const content = task.requirementDocContent?.trim() || task.requirementDescription?.trim()
  if (content) {
    blocks.push('', t('需求内容：'), content.slice(0, REQ_IDENTIFY_LEN))
  }

  appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)

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
  opts?: { knowledgeBaseMarkdown?: string }
): string {
  const blocks = [
    ...pipelineOpeningLines(t),
    t('请按照我们刚才讨论的方案，输出任务拆解结果。'),
    t('格式要求：每个子任务单独一行，以 - 开头，格式为「- 子任务标题: 简要说明」。'),
    t('不需要其他说明，直接输出子任务列表。'),
  ]
  appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  return blocks.join('\n')
}

/**
 * 开始工作 Tab 3 — asks AI to output the final dev plan text for saving.
 */
export function buildDevPlanExecuteMessage(t: TFunction, opts?: { knowledgeBaseMarkdown?: string }): string {
  const blocks = [
    ...pipelineOpeningLines(t),
    t('请按照我们刚才讨论的方案，输出最终的开发计划。'),
    t('包括：1. 涉及的项目和代码模块（每项以 - 开头）；2. 具体代码改动范围说明。'),
  ]
  appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  return blocks.join('\n')
}

/**
 * 开始工作 Tab 4 — kicks off the actual coding phase.
 * Includes the dev plan so the AI has full context to start implementing.
 */
export function buildCodingKickoffMessage(
  task: WorkspaceTask,
  t: TFunction,
  ctx?: { workspaceRoot?: string; projectPaths?: string[]; knowledgeBaseMarkdown?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
    t('现在进入编码实现阶段。请根据以下开发计划，开始逐步执行代码改动。'),
    t('执行要求：'),
    t('1. 按照开发计划中的模块和文件范围进行修改'),
    t('2. 每完成一个模块或文件，简要说明改动内容'),
    t('3. 遇到不确定的地方，先列出问题再继续'),
    '',
    t('任务名称：{{name}}', { name: task.name }),
  ]

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

  appendKnowledgeBaseMarkdownBlock(blocks, ctx?.knowledgeBaseMarkdown, t)

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
