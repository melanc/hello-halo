/**
 * Composer reference labels and agent prompts for workspace task workflows.
 */

import type { TFunction } from 'i18next'
import type { PipelineStage, PipelineSubtask, PipelineDevPlanProject, WorkspaceTask } from '../types'

const DOC_EXCERPT_LEN = 600
const DESC_EXCERPT_LEN = 400
const REQ_IDENTIFY_LEN = 3000
const REQ_ANALYSIS_EXCERPT_LEN = 800
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

/** Tab 4 — require saved dev plan text, at least one project dir, and a non-empty branch.
 * For simple tasks (taskType === 'simple'), the dev plan check is skipped. */
export function evaluateCodingPrereqs(task: WorkspaceTask, t: TFunction): { ok: boolean; message: string } {
  const isSimple = task.taskType === 'simple'
  if (!isSimple) {
    const plan = task.pipelineDevPlan?.trim() ?? ''
    if (!plan) {
      return {
        ok: false,
        message: t('编码前请先在标签 3 完成开发计划与代码范围。'),
      }
    }
  }
  const dirs = getInvolvedProjectDirNames(task)
  const branch = task.branchName?.trim() ?? ''
  if (!isSimple && (dirs.length === 0 || !branch)) {
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
    const isSimple = task.taskType === 'simple'
    if (isSimple) {
      // Simple tasks skip tabs 2 & 3; only require that requirement analysis exists
      const hasReqContent =
        !!task.requirementAnalysis?.trim() ||
        !!task.requirementDocContent?.trim() ||
        !!task.requirementDescription?.trim()
      if (!hasReqContent) {
        return {
          ok: false,
          message: t('请先在需求识别（标签 1）中完成需求分析，再开始编码。'),
        }
      }
      return { ok: true }
    }
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
    return t('暂无拆解子任务记录，请仅根据开发计划和对话内容推断进度。')
  }
  const lines: string[] = []
  const { doneCount, total } = getSubtaskProgressStats(list)
  lines.push(
    t('子任务看板：{{done}} / {{total}} 已完成（pending 和 in_progress 均为未完成）。', {
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
  appendGroup(t('已完成：'), list.filter((s) => s.status === 'done'))
  appendGroup(t('进行中：'), list.filter((s) => s.status === 'in_progress'))
  appendGroup(t('待处理：'), list.filter((s) => s.status === 'pending'))
  return lines.join('\n')
}

/**
 * Shared role preamble prepended to every task-pipeline message.
 * Gives the AI a consistent identity and scope for the entire workflow.
 */
const ROLE_PREAMBLE =
  '你是一名软件需求开发工程师，你的职责是：识别和分析需求、拆解开发任务、生成开发计划、指导代码实现。'

/** Prefer Chinese model replies in task-pipeline messages. */
function replyLanguageConstraint(_t: TFunction): string {
  return '请全程使用中文与我交流（代码块、文件路径、标识符及不可避免的英文技术术语除外）。'
}

/** Role line + language preference, inserted at the start of pipeline prompts. */
function pipelineOpeningLines(t: TFunction): string[] {
  return [
    ROLE_PREAMBLE,
    '',
    replyLanguageConstraint(t),
    t('项目路径必须自己用工具查，不得列为"待确认问题"向用户询问：先用 Glob 在当前工作目录（空间根目录）下搜索项目名称，搜到即可确认路径；只有 Glob 确实找不到任何匹配时，才可以询问用户。'),
    '',
  ]
}

function appendKnowledgeBaseMarkdownBlock(blocks: string[], markdown: string | undefined, t: TFunction): void {
  const m = markdown?.trim()
  if (!m) return
  blocks.push(
    '',
    t('--- 已关联知识库（Markdown 摘录，供业务/架构参考）---'),
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
    t('当前阶段仅限于需求识别，不要执行任务拆解、制定开发计划或修改代码。如对话触及上述内容，请告知用户先完成"确认需求"再继续。'),
    '',
  ]

  if (opts?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在整理需求分析之前，请先查阅知识库中的需求识别引导文档：'),
      t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
      t('2. 查找"需求识别引导"相关文档（文件名通常包含"需求识别"、"requirement"、"guide"等关键词），阅读其内容'),
      t('3. 如果找到了引导文档，按其规范输出需求分析；如果没找到，按下述默认结构输出'),
      '',
    )
  }

  const hasDoc = !!(task.requirementDocName?.trim() || task.requirementDocContent?.trim())

  if (hasDoc) {
    // After interactive confirmation, ask AI to finalize the structured output
    blocks.push(
      t('请根据我们刚才逐条确认的需求点，整理并输出最终的结构化需求分析。'),
      '',
      t('任务名称：{{name}}', { name: task.name }),
    )
    if (task.requirementDocName?.trim()) {
      blocks.push(t('需求文档：{{name}}', { name: task.requirementDocName.trim() }))
    }
  } else {
    blocks.push(
      t('请根据我们已确认的需求，直接输出结构化的需求要点，不需要再提问或确认。'),
      '',
      t('任务名称：{{name}}', { name: task.name }),
    )
    const content = task.requirementDocContent?.trim() || task.requirementDescription?.trim()
    if (content) {
      blocks.push('', t('需求内容：'), content.slice(0, REQ_IDENTIFY_LEN))
    }
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
    knowledgeBaseRoot?: string
    projectDirs?: string[]
  },
  t: TFunction
): string {
  const header = `任务名称：${task.name}`

  switch (tab) {
    case 1: {
      const hasDoc = !!(task.requirementDocName?.trim() || task.requirementDocContent?.trim())
      const blocks = [
        ...pipelineOpeningLines(t),
        t('当前阶段仅限于需求识别，不要执行任务拆解、制定开发计划或修改代码。如对话触及上述内容，请告知用户先完成"确认需求"再继续。'),
        '',
      ]
      if (hasDoc) {
        if (opts.knowledgeBaseRoot?.trim()) {
          blocks.push(
            t('在处理需求文档前，请先查阅知识库中的需求识别引导文档：'),
            t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
            t('2. 查找"需求识别引导"相关文档（文件名通常包含"需求识别"、"requirement"、"guide"等关键词），阅读其内容'),
            t('3. 如果找到了引导文档，按其规范处理需求；如果没找到，按下述默认步骤处理'),
            t('4. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: opts.knowledgeBaseRoot.trim() }),
            t('5. 如果某个项目的技术知识文档不存在，使用 Task 工具（subagent_type="Explore"）对该项目进行代码探索，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: opts.knowledgeBaseRoot.trim() }),
            '',
          )
        }
        blocks.push(
          t('请按以下步骤处理这份需求文档：'),
          t('第一步：整体理解确认'),
          t('先整体阅读需求文档，概括要做哪几个子需求（不需要逐条展开），让我确认你是否理解了需求文档。我可能会对某些地方进行纠正，请根据我的反馈调整理解，直到我确认整体没问题。'),
          '',
          t('第二步：详细子需求梳理'),
          t('整体确认无误后，逐一列出所有子需求，并说明每个子需求在服务端需要改动哪些地方。我会进行纠正，请根据反馈修改，直到整体没问题后告知我，我会点击"开始工作"让你整理最终结果。'),
          '',
          t('注意：以上两个步骤中，如果有任何不确定的地方，主动向我提问。'),
          '',
        )
      } else {
        blocks.push(
          t('请分析以下需求，告诉我：'),
          t('1. 你理解到的需求背景和目标是什么'),
          t('2. 你打算提取哪些核心功能要点'),
          t('3. 有哪些地方不清楚，需要进一步确认'),
          '',
        )
      }
      blocks.push(header)
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
        t('当前阶段仅限于任务拆解，不要制定开发计划或修改代码。如对话触及上述内容，请告知用户先点击"下一步"进入下一阶段。'),
        '',
      ]
      if (opts.knowledgeBaseRoot?.trim()) {
        blocks.push(
          t('在开始任务拆解前，请先查阅知识库中的任务拆解引导文档：'),
          t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
          t('2. 查找"任务拆解引导"相关文档（文件名通常包含"任务拆解"、"task-breakdown"、"breakdown"等关键词），阅读其内容'),
          t('3. 如果找到了引导文档，按其规范进行拆解；如果没找到，按下述默认步骤处理'),
          t('4. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: opts.knowledgeBaseRoot.trim() }),
          t('5. 如果某个项目的技术知识文档不存在，使用 Task 工具（subagent_type="Explore"）对该项目进行代码探索，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: opts.knowledgeBaseRoot.trim() }),
          '',
        )
      }
      blocks.push(
        t('请根据以下需求要点，列出你的任务拆解方案：'),
        t('1. 打算拆分哪些子任务，每个子任务的目标是什么'),
        t('2. 子任务之间的依赖关系和执行顺序'),
        t('3. 有哪些不确定的地方需要先确认'),
        '',
        header,
      )
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
      ]
      if (opts.knowledgeBaseRoot?.trim()) {
        const kbRoot = opts.knowledgeBaseRoot.trim()
        const projectList = opts.projectDirs?.length
          ? opts.projectDirs.join('、')
          : t('涉及的项目')
        blocks.push(
          t('在开始制定开发计划前，请先按以下步骤查阅知识库：'),
          t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: kbRoot }),
          t('2. 优先查找"开发计划引导"文档（文件名通常包含"开发计划"、"dev-plan"、"planning"等关键词），如果找到则阅读并按其规范制定计划'),
          t('3. 在 {{path}}/项目介绍/ 目录下查找涉及项目（{{projects}}）对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: kbRoot, projects: projectList }),
          t('4. 如果某个项目的技术知识文档不存在，则先对该项目进行代码梳理：'),
          t('   a. 使用 Task 工具（subagent_type="Explore"）探索项目目录结构，理解整体架构和核心模块'),
          t('   b. 将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md（如 {{path}}/项目介绍/talcamp技术知识.md）', { path: kbRoot }),
          t('   c. 写入完成后继续'),
          t('5. 基于以上收集到的信息，再制定开发计划'),
          '',
        )
      }
      blocks.push(
        t('请根据以下子任务列表，说明你的开发计划：'),
        t('1. 涉及哪些项目 / 代码模块'),
        t('2. 主要代码改动范围和实现思路'),
        t('3. 有哪些需要用户确认或存在风险的地方'),
        '',
        header,
      )
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
      ]
      if (opts.knowledgeBaseRoot?.trim()) {
        blocks.push(
          t('在开始编码前，请先按以下步骤查阅知识库：'),
          t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
          t('2. 查找"编码实现引导"相关文档（文件名通常包含"编码"、"coding"、"implementation"等关键词），如果找到则按其规范进行编码；如果没找到，按通用编码规范处理'),
          t('3. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: opts.knowledgeBaseRoot.trim() }),
          t('4. 如果某个项目没有技术知识文档，先用 Glob 浏览该项目目录结构，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: opts.knowledgeBaseRoot.trim() }),
          '',
        )
      }
      blocks.push(
        t('请审查开发计划和子任务完成记录，判断还剩哪些工作未完成。'),
        t('1. 对照计划判断：整体是否完成；计划条目与已完成子任务之间有哪些差距'),
        t('2. 如有未完成工作：列出有序的下一步操作和具体涉及的文件或模块'),
        t('3. 开始修改前，列出风险点或需要确认的问题'),
        '',
        header,
      )
      const plan = task.pipelineDevPlan?.trim()
      if (plan) {
        blocks.push('', t('开发计划（必须遵照执行）：'), plan.slice(0, DEV_PLAN_EXCERPT_LEN))
      }
      if (task.branchName?.trim()) {
        blocks.push('', t('开发分支：{{branch}}', { branch: task.branchName.trim() }))
      }
      if (opts.codingWorkspaceRoot?.trim()) {
        blocks.push('', t('工作区根路径：{{path}}', { path: opts.codingWorkspaceRoot.trim() }))
      }
      if (opts.codingProjectPaths?.length) {
        blocks.push('', t('涉及的项目路径（工作区下的顶级目录）：'))
        opts.codingProjectPaths.forEach((p) => blocks.push(`- ${p}`))
      } else if (getInvolvedProjectDirNames(task).length) {
        blocks.push('', t('涉及的项目目录（相对名称）：'))
        getInvolvedProjectDirNames(task).forEach((d) => blocks.push(`- ${d}`))
      }
      blocks.push('', t('--- 子任务完成记录（以此为准）---'))
      blocks.push(formatSubtasksProgressForPrompt(opts.subtasks, t))
      blocks.push(
        '',
        t('请对照以上子任务完成记录与开发计划。'),
        t('你的回复必须包含：'),
        t('• 明确结论：相对于计划和子任务状态，整体是否全部完成。'),
        t('• 如有未完成：列出编号的"下一步"，明确指出具体的待处理或进行中子任务或计划节点。'),
        t('• 如果你认为全部完成：说明原因，并建议关闭前需要验证的内容（测试、手动检查等）。'),
        t('• 指出任何未被子任务覆盖的计划条目，或已完成但仍存在计划缺口的子任务。'),
        '',
        t('最后输出一个简洁的"本次计划改动"说明，针对即将进行的编码片段——暂不修改文件。')
      )
      if (!opts.knowledgeBaseRoot?.trim()) {
        appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      }
      return blocks.join('\n')
    }
    case 5: {
      const blocks = [
        ...pipelineOpeningLines(t),
      ]
      if (opts.knowledgeBaseRoot?.trim()) {
        blocks.push(
          t('在开始验证收尾前，请先按以下步骤查阅知识库：'),
          t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
          t('2. 查找"验证收尾引导"相关文档（文件名通常包含"验证"、"verification"、"test"等关键词），如果找到则按其规范制定验证计划；如果没找到，按下述默认步骤处理'),
          t('3. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: opts.knowledgeBaseRoot.trim() }),
          t('4. 如果某个项目没有技术知识文档，先用 Glob 浏览该项目目录结构，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: opts.knowledgeBaseRoot.trim() }),
          '',
        )
      }
      blocks.push(
        t('请说明你的验证收尾计划：'),
        t('1. 要检查哪些代码逻辑和边界情况'),
        t('2. 要运行哪些测试'),
        t('3. 有哪些已知风险点'),
        '',
        header,
      )
      if (!opts.knowledgeBaseRoot?.trim()) {
        appendKnowledgeBaseMarkdownBlock(blocks, opts.knowledgeBaseMarkdown, t)
      }
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
    t('当前阶段仅限于任务拆解，不要制定开发计划或修改代码。如对话触及上述内容，请告知用户先点击"下一步"进入下一阶段。'),
    '',
  ]

  if (opts?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在生成任务拆解之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: opts.knowledgeBaseRoot.trim() }),
      t('2. 找到任务拆解引导文件（文件名通常包含"任务拆解"、"task-breakdown"、"breakdown"等关键词），阅读其内容'),
      t('3. 按照该引导文件的规范生成子任务列表'),
      t('如果找不到引导文件，按通用方法处理。'),
      t('4. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: opts.knowledgeBaseRoot.trim() }),
      t('5. 如果某个项目的技术知识文档不存在，使用 Task 工具（subagent_type="Explore"）对该项目进行代码探索，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: opts.knowledgeBaseRoot.trim() }),
      '',
    )
  }

  blocks.push(
    t('请根据我们已确认的需求，直接按以下格式输出任务拆解结果，不需要再提问或确认：'),
    '',
    t('格式要求：'),
    t('- 按"要做的事"分类分组，每个分组以 ## 开头写分组名称'),
    t('- 分组下每个子任务单独一行以 - 开头，格式严格为：「- 子任务标题 (涉及项目1, 涉及项目2): 简要说明」'),
    t('- 括号中只填写该子任务会改动的项目名称；冒号后写一句简要说明'),
    t('- 每一条 - 列表项必须是一个可执行的任务，不能是代码片段、行号、文件路径或分析说明'),
    t('- 所有背景信息、现有代码引用、行号等均不得作为独立的 - 列表项出现，如需说明请折叠进「简要说明」中'),
    '',
    t('正确示例：'),
    t('## 修复编译问题'),
    t('- 修复 gently handler 的 import (talcamp): 补全缺失的包引用'),
    t('- 修复 ZK 注册服务名 (vote-service, duration-service): 改为正确的服务名'),
    t('## 移除旧逻辑'),
    t('- 移除 plog 埋点 (talcamp): 删除 plog 相关代码及 import'),
    '',
    t('错误示例（禁止出现以下形式）：'),
    t('- `define.PatternType[PatternTwentyTwo]` = struct{}{}'),
    t('- line 167'),
    t('- Project involved: xxx'),
    t('- File: xxx/xxx.go'),
    '',
    t('只输出分组子任务列表，不输出任何分析过程、代码片段、行号引用或文件路径。'),
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
  task: WorkspaceTask,
  subtasks: PipelineSubtask[] | undefined,
  t: TFunction,
  opts?: { knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string; projectDirs?: string[] }
): string {
  const blocks = [
    ...pipelineOpeningLines(t),
  ]

  // Task context — inject explicitly so the model doesn't rely solely on conversation history
  blocks.push(t('任务名称：{{name}}', { name: task.name }))
  const reqAnalysis = task.requirementAnalysis?.trim()
  if (reqAnalysis) {
    blocks.push('', t('需求分析：'), reqAnalysis.slice(0, REQ_ANALYSIS_EXCERPT_LEN))
  }
  if (subtasks?.length) {
    blocks.push('', t('子任务列表：'))
    subtasks.forEach((st) => blocks.push(`- ${st.title}${st.description ? '：' + st.description : ''}`))
  }
  blocks.push('')

  if (opts?.knowledgeBaseRoot?.trim()) {
    const kbRoot = opts.knowledgeBaseRoot.trim()
    const projectList = opts.projectDirs?.length
      ? opts.projectDirs.join('、')
      : t('涉及的项目')
    blocks.push(
      t('在生成开发计划之前，请先按以下步骤处理项目知识文档：'),
      t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: kbRoot }),
      t('2. 在 {{path}}/项目介绍/ 目录下查找涉及项目（{{projects}}）对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { projects: projectList, path: kbRoot }),
      t('3. 如果找到了对应项目的技术知识文档，阅读其内容，然后跳到第 5 步'),
      t('4. 如果某个项目没有技术知识文档，则先对该项目进行代码梳理：'),
      t('   a. 使用 Task 工具（subagent_type="Explore"）探索项目目录结构，理解整体架构和核心模块'),
      t('   b. 将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md（如 {{path}}/项目介绍/talcamp技术知识.md）', { path: kbRoot }),
      t('   c. 写入完成后继续'),
      t('5. 基于读取到的项目知识文档，生成开发计划'),
      '',
    )
  } else {
    blocks.push(
      t('在制定开发计划之前，请先探索涉及的项目代码：'),
      t('1. 使用 Task 工具（subagent_type="Explore"）对涉及项目进行宏观探索，理解整体架构和核心模块'),
      t('2. 按需用 Glob/Grep/Read 精确查询具体文件、接口或关键逻辑'),
      t('3. 基于实际代码结构制定计划，不要假设文件位置或接口'),
      '',
    )
  }

  blocks.push(
    t('请先简要说明开发思路，然后直接按以下格式输出代码改动计划，精确到文件级别，不需要再提问或确认：'),
    '',
    t('格式要求：'),
    t('- 以 ## 项目名 作为每个项目的标题（例如 ## talcamp）'),
    t('- 每个项目下列出需要改动的具体文件，格式为：'),
    t('  `- \\`文件路径\\` — 改动说明（例如：修改第34行函数签名、新增接口实现等）`'),
    t('- 新增文件：`- \\`新增：文件路径\\` — 说明新文件的作用`'),
    t('- 删除文件：`- \\`删除：文件路径\\` — 说明删除原因`'),
    '',
    t('示例：'),
    t('本次主要修复 ZK 注册逻辑，并移除历史遗留的 plog 埋点模块。'),
    '',
    t('## talcamp'),
    t('- `src/handlers/gently.go` — 修正第12行 import 路径，移除 plog 引用'),
    t('- `删除：src/utils/plog.go` — 移除埋点模块'),
    t('## vote-service'),
    t('- `internal/server/register.go` — 第34行修正 ZK 注册服务名'),
    '',
    t('开发思路简介放在所有 ## 项目列表之前，其余多余说明不需要。'),
  )

  if (!opts?.knowledgeBaseRoot?.trim()) {
    appendKnowledgeBaseMarkdownBlock(blocks, opts?.knowledgeBaseMarkdown, t)
  }

  return blocks.join('\n')
}

/**
 * Parse an AI-generated dev plan markdown into a structured list of projects + file items.
 * Expects the format produced by buildDevPlanExecuteMessage:
 *   ## ProjectName
 *   - `filepath` — description
 */
export function parseDevPlan(markdown: string): PipelineDevPlanProject[] {
  const projects: PipelineDevPlanProject[] = []
  let current: PipelineDevPlanProject | null = null
  for (const line of markdown.split('\n')) {
    const h2 = line.match(/^##\s+(.+)/)
    if (h2) {
      current = { name: h2[1].trim(), items: [], checked: false }
      projects.push(current)
      continue
    }
    if (current) {
      const item = line.match(/^\s*-\s+`([^`]+)`\s*[—–-]\s*(.+)/)
      if (item) {
        current.items.push({ path: item[1].trim(), description: item[2].trim(), done: false })
      }
    }
  }
  return projects
}

/**
 * 开始工作 Tab 4 — kicks off the actual coding phase.
 * Includes the dev plan so the AI has full context to start implementing.
 */
export function buildCodingKickoffMessage(
  task: WorkspaceTask,
  t: TFunction,
  ctx?: { workspaceRoot?: string; projectPaths?: string[]; knowledgeBaseMarkdown?: string; knowledgeBaseRoot?: string; selectedPlanMarkdown?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
  ]

  if (ctx?.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在开始编码之前，请先执行以下步骤：'),
      t('1. 使用你的工具（Read、Glob 等）浏览知识库目录：{{path}}', { path: ctx.knowledgeBaseRoot.trim() }),
      t('2. 查找编码实现引导文件（文件名通常包含"编码"、"coding"、"implementation"等关键词），如果找到则按其规范进行编码；如果没找到，按通用编码规范处理'),
      t('3. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: ctx.knowledgeBaseRoot.trim() }),
      t('4. 如果某个项目没有技术知识文档，先用 Glob 浏览该项目目录结构，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: ctx.knowledgeBaseRoot.trim() }),
      '',
    )
  }

  blocks.push(
    t('现在进入编码实现阶段。请先审查以下开发计划和子任务完成情况，判断待完成的工作（哪些已完成、哪些还剩余、有无计划遗漏），然后开始逐步执行代码改动。'),
    t('执行要求：'),
    t('1. 动态探索代码：不要假设文件位置或内容，先用 Glob/Grep 了解涉及项目的目录结构和关键模块，按需读取相关文件后再开始修改'),
    t('2. 改动确认：在实际修改任何文件之前，必须先调用 mcp__halo-pipeline__announce_file_changes 工具，列出所有计划修改的文件及改动原因，等待用户确认后再执行。若用户取消，停止所有文件修改并向用户说明'),
    t('3. 按照开发计划中的模块和文件范围进行修改'),
    t('4. 每完成一个模块或文件，简要说明改动内容'),
    t('5. 遇到不确定的地方，先列出问题再继续'),
    '',
    t('任务名称：{{name}}', { name: task.name }),
  )

  if (task.branchName?.trim()) {
    blocks.push('', t('开发分支：{{branch}}', { branch: task.branchName.trim() }))
  }
  if (ctx?.workspaceRoot?.trim()) {
    blocks.push('', t('工作区根路径：{{path}}', { path: ctx.workspaceRoot.trim() }))
  }
  if (ctx?.projectPaths?.length) {
    blocks.push('', t('涉及的项目路径（除非计划另有说明，只在这些范围内修改）：'))
    ctx.projectPaths.forEach((p) => blocks.push(`- ${p}`))

    // if (ctx.projectPaths.length > 1) {
    //   blocks.push(
    //     '',
    //     t('多项目并行处理：本任务涉及 {{count}} 个项目路径，请使用 Task 工具并行处理以提高效率：', { count: ctx.projectPaths.length }),
    //     t('1. 为每个项目路径启动一个独立的子 Agent（通过 Task 工具）'),
    //     t('2. 每个子 Agent 的 prompt 中应包含：该项目的路径、完整开发计划、分支名称、以及相关子任务上下文'),
    //     t('3. 子 Agent 只在其对应的项目路径范围内进行修改'),
    //     t('4. 等待所有子 Agent 完成后，汇总各项目的改动情况并向用户报告'),
    //   )
    // }
  }

  const planToUse = ctx?.selectedPlanMarkdown?.trim() ?? task.pipelineDevPlan?.trim()
  if (planToUse) {
    blocks.push('', t('开发计划：'), planToUse.slice(0, DEV_PLAN_EXCERPT_LEN))
  } else if (task.pipelineSubtasks?.length) {
    blocks.push('', t('子任务列表：'))
    task.pipelineSubtasks.forEach((st) =>
      blocks.push(`- ${st.title}${st.description ? '：' + st.description : ''}`)
    )
  }

  const sts = task.pipelineSubtasks ?? []
  blocks.push('', t('--- 子任务完成记录（由用户在任务面板中标记）---'))
  blocks.push(formatSubtasksProgressForPrompt(sts, t))
  blocks.push(
    '',
    t('请结合开发计划和此完成记录进行工作。'),
    t('优先实现剩余工作（待处理 / 进行中的子任务及计划中遗漏的部分）。'),
    t('如果所有子任务已标记完成，请与计划核对；仅修复剩余差距或执行检查。'),
    t('完成实质性修改后，提醒用户更新子任务勾选状态，以便下次开始工作时信息准确。')
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
export function buildVerificationExecuteMessage(
  task: WorkspaceTask,
  t: TFunction,
  ctx: { depCheckCmd?: string; buildCheckCmd?: string; apiTestCmd?: string; knowledgeBaseRoot?: string }
): string {
  const blocks: string[] = [
    ...pipelineOpeningLines(t),
  ]

  if (ctx.knowledgeBaseRoot?.trim()) {
    blocks.push(
      t('在开始验证检查之前，请先执行以下步骤：'),
      t('1. 使用 Glob/Read 工具浏览知识库目录：{{path}}', { path: ctx.knowledgeBaseRoot.trim() }),
      t('2. 查找"验证收尾引导"相关文档（文件名通常包含"验证"、"verification"、"test"等关键词），如果找到则按其规范执行验证；如果没找到，按下述默认步骤处理'),
      t('3. 在 {{path}}/项目介绍/ 目录下查找涉及项目对应的技术知识文档（文件名通常为"项目名技术知识.md"）', { path: ctx.knowledgeBaseRoot.trim() }),
      t('4. 如果某个项目没有技术知识文档，先用 Glob 浏览该项目目录结构，将梳理结果写入 {{path}}/项目介绍/项目名技术知识.md，完成后继续', { path: ctx.knowledgeBaseRoot.trim() }),
      '',
    )
  }

  blocks.push(
    t('请先制定验证计划（要检查哪些代码逻辑和边界情况、要运行哪些测试、已知风险点），然后按以下步骤逐步执行并汇报每步结果：'),
    '',
    t('## 步骤 1：语法检查'),
    t('对涉及项目的代码进行静态语法分析，报告所有错误和警告。'),
    '',
  )

  if (ctx.depCheckCmd?.trim()) {
    blocks.push(
      t('## 步骤 2：依赖检查'),
      t('执行以下命令进行依赖检查，并报告结果（成功 / 失败 + 错误详情）：'),
      '```',
      ctx.depCheckCmd.trim(),
      '```',
      '',
    )
  }

  if (ctx.buildCheckCmd?.trim()) {
    blocks.push(
      t('## 步骤 3：编译检查'),
      t('执行以下命令进行编译检查，并报告结果（成功 / 失败 + 错误详情）：'),
      '```',
      ctx.buildCheckCmd.trim(),
      '```',
      '',
    )
  }

  if (ctx.apiTestCmd?.trim()) {
    blocks.push(
      t('## 步骤 4：接口用例验证'),
      t('执行以下 curl 命令进行接口验证，逐条执行并报告每条的响应结果（状态码、响应体摘要），判断接口是否符合预期：'),
      '```',
      ctx.apiTestCmd.trim(),
      '```',
      '',
    )
  }

  blocks.push(
    t('改动确认：如果需要修改任何文件（例如修复发现的错误），必须先调用 mcp__halo-pipeline__announce_file_changes 工具，列出所有计划修改的文件及改动原因，等待用户确认后再执行。'),
    '',
    t('所有步骤完成后，给出综合评估：是否可以合入主干，以及需要修复的问题列表。'),
    '',
    t('--- 任务信息 ---'),
    t('任务名称：{{name}}', { name: task.name }),
  )

  if (task.pipelineDevPlan?.trim()) {
    blocks.push('', t('开发计划：'), task.pipelineDevPlan.trim().slice(0, 1200))
  }

  return blocks.join('\n')
}

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
    t('0. 在写入文件前，先调用 mcp__halo-pipeline__announce_file_changes 工具，告知将要修改的文件路径及原因，等待用户确认'),
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
