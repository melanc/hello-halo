/**
 * Composer reference labels and agent prompts for workspace task workflows.
 */

import type { TFunction } from 'i18next'
import type { PipelineStage, PipelineSubtask, WorkspaceTask } from '../types'

const DOC_EXCERPT_LEN = 600
const DESC_EXCERPT_LEN = 400
const REQ_IDENTIFY_LEN = 3000

/**
 * Shared role preamble prepended to every task-pipeline message.
 * Gives the AI a consistent identity and scope for the entire workflow.
 */
const ROLE_PREAMBLE =
  '你是一名软件需求开发工程师，你的职责是：识别和分析需求、拆解开发任务、生成开发计划、指导代码实现。'

/**
 * Message that asks the AI to identify and analyse requirements from the uploaded doc / description.
 * The full doc content (up to REQ_IDENTIFY_LEN chars) is included so the AI can extract key points.
 */
export function buildRequirementIdentifyMessage(task: WorkspaceTask, t: TFunction): string {
  const blocks: string[] = [
    ROLE_PREAMBLE,
    '',
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
  opts: { subtasks?: PipelineSubtask[]; keyPoints?: string[] },
  t: TFunction
): string {
  const header = `任务名称：${task.name}`

  switch (tab) {
    case 1: {
      const blocks = [
        ROLE_PREAMBLE,
        '',
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
      return blocks.join('\n')
    }
    case 2: {
      const blocks = [
        ROLE_PREAMBLE,
        '',
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
      return blocks.join('\n')
    }
    case 3: {
      const blocks = [
        ROLE_PREAMBLE,
        '',
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
      return blocks.join('\n')
    }
    case 4: {
      const blocks = [
        ROLE_PREAMBLE,
        '',
        t('请根据当前任务的开发计划，说明你将如何执行编码：'),
        t('1. 具体实现步骤'),
        t('2. 要修改的关键文件和接口'),
        t('3. 需要用户确认或可能有风险的地方，请先列出问题'),
        '',
        header,
      ]
      return blocks.join('\n')
    }
    case 5: {
      const blocks = [
        ROLE_PREAMBLE,
        '',
        t('请说明你的验证收尾计划：'),
        t('1. 要检查哪些代码逻辑和边界情况'),
        t('2. 要运行哪些测试'),
        t('3. 有哪些已知风险点'),
        '',
        header,
      ]
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
export function buildTaskBreakdownExecuteMessage(t: TFunction): string {
  return [
    ROLE_PREAMBLE,
    '',
    t('请按照我们刚才讨论的方案，输出任务拆解结果。'),
    t('格式要求：每个子任务单独一行，以 - 开头，格式为「- 子任务标题: 简要说明」。'),
    t('不需要其他说明，直接输出子任务列表。'),
  ].join('\n')
}

/**
 * 开始工作 Tab 3 — asks AI to output the final dev plan text for saving.
 */
export function buildDevPlanExecuteMessage(t: TFunction): string {
  return [
    ROLE_PREAMBLE,
    '',
    t('请按照我们刚才讨论的方案，输出最终的开发计划。'),
    t('包括：1. 涉及的项目和代码模块（每项以 - 开头）；2. 具体代码改动范围说明。'),
  ].join('\n')
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
  return lines.join('\n')
}

/** User message that asks the agent for a review-only implementation plan first. */
export function buildImplementationPlanKickoffMessage(task: WorkspaceTask, t: TFunction): string {
  const blocks: string[] = [
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
