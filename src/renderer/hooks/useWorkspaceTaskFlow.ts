/**
 * Workspace task actions: supplement (composer reference) and implementation kickoff (plan-first).
 */

import { useCallback } from 'react'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chat.store'
import type { Space, WorkspaceTask } from '../types'
import {
  buildImplementationPlanKickoffMessage,
  buildWorkspaceTaskComposerReferenceLabel,
} from '../lib/workspace-task-messages'
import { navigateToWorkspaceTaskConversation } from '../lib/workspace-task-navigation'
import { useConfirmDialog } from './useConfirmDialog'

export function useWorkspaceTaskFlow(options: {
  allSpaces: Space[]
  onMissingRequirement: (taskId: string) => void
  /** From home: open space tab */
  switchToSpaceView?: () => void
}) {
  const { t } = useTranslation()
  const { showConfirm, DialogComponent } = useConfirmDialog()
  const { allSpaces, onMissingRequirement, switchToSpaceView } = options

  const supplementTask = useCallback(
    async (task: WorkspaceTask) => {
      if (!task.requirementBreakdownUsed) return
      const ok = await navigateToWorkspaceTaskConversation({
        task,
        allSpaces,
        onMissingRequirement,
        switchToSpaceView,
      })
      if (!ok) return
      const chat = useChatStore.getState()
      chat.clearComposerReferenceChips()
      chat.addComposerReferenceChip(buildWorkspaceTaskComposerReferenceLabel(task, t))
      chat.bumpComposerFocus()
    },
    [allSpaces, onMissingRequirement, switchToSpaceView, t]
  )

  const startImplementation = useCallback(
    async (task: WorkspaceTask) => {
      if (!task.requirementBreakdownUsed) return
      const ok = await navigateToWorkspaceTaskConversation({
        task,
        allSpaces,
        onMissingRequirement,
        switchToSpaceView,
      })
      if (!ok) return

      const chat = useChatStore.getState()
      const sess = chat.getSession(task.conversationId)
      if (sess.isGenerating) {
        const proceed = await showConfirm({
          title: t('The assistant is still responding. Send the implementation plan request anyway?'),
          confirmLabel: t('Confirm'),
          cancelLabel: t('Cancel'),
          variant: 'default',
        })
        if (!proceed) return
      }

      chat.clearComposerReferenceChips()
      await chat.sendMessage(
        buildImplementationPlanKickoffMessage(task, t),
        undefined,
        undefined,
        undefined
      )
    },
    [allSpaces, onMissingRequirement, switchToSpaceView, showConfirm, t]
  )

  return { supplementTask, startImplementation, DialogComponent }
}
