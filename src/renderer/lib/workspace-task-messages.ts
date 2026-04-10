/**
 * Composer reference labels and agent prompts for workspace task workflows.
 */

import type { TFunction } from 'i18next'
import type { WorkspaceTask } from '../types'

const DOC_EXCERPT_LEN = 600
const DESC_EXCERPT_LEN = 400
const REQ_IDENTIFY_LEN = 3000

/**
 * Message that asks the AI to identify and analyse requirements from the uploaded doc / description.
 * The full doc content (up to REQ_IDENTIFY_LEN chars) is included so the AI can extract key points.
 */
export function buildRequirementIdentifyMessage(task: WorkspaceTask, t: TFunction): string {
  const blocks: string[] = [
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
