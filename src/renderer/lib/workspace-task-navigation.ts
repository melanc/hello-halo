/**
 * Navigate to a workspace task's main conversation (space + chat selection).
 */

import { useChatStore } from '../stores/chat.store'
import { useSpaceStore } from '../stores/space.store'
import { useTaskStore } from '../stores/task.store'
import type { Space, WorkspaceTask } from '../types'

export function taskHasRequirementContent(task: WorkspaceTask): boolean {
  const hasDoc = Boolean(task.requirementDocName?.trim() && task.requirementDocContent?.trim())
  const hasDesc = Boolean(task.requirementDescription?.trim())
  return hasDoc || hasDesc
}

export async function navigateToWorkspaceTaskConversation(options: {
  task: WorkspaceTask
  allSpaces: Space[]
  /** When requirement is missing */
  onMissingRequirement: (taskId: string) => void
  /** e.g. from home page — open space view */
  switchToSpaceView?: () => void
}): Promise<boolean> {
  const { task, allSpaces, onMissingRequirement, switchToSpaceView } = options

  if (!taskHasRequirementContent(task)) {
    onMissingRequirement(task.id)
    return false
  }

  const space = allSpaces.find((s) => s.id === task.spaceId)
  if (!space) return false
  if (space.workspaceKind === 'knowledge_base') {
    onMissingRequirement(task.id)
    return false
  }

  const chatBefore = useChatStore.getState()
  const alreadyOnSpace = chatBefore.currentSpaceId === space.id
  const taskMetaPresent = chatBefore
    .getSpaceState(space.id)
    .conversations.some((c) => c.id === task.conversationId)

  useSpaceStore.getState().setCurrentSpace(space)
  useTaskStore.getState().setActiveTask(task.id)
  useChatStore.getState().setCurrentSpace(space.id)

  switchToSpaceView?.()

  await useSpaceStore.getState().refreshCurrentSpace()

  if (!alreadyOnSpace || !taskMetaPresent) {
    await useChatStore.getState().loadConversations(space.id, { silent: true })
  }

  await useChatStore.getState().selectConversation(task.conversationId)
  return true
}
