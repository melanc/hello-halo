/**
 * Workspace task conversation ID utilities.
 *
 * Workspace tasks use a namespaced conversation ID format to isolate
 * task conversations from regular space conversations. This follows the
 * same pattern as app chats (app-chat:{appId}).
 *
 * The prefix MUST be filesystem-safe across all platforms
 * (no colons, slashes, or special glob characters — Windows-compatible).
 */

export const WORKSPACE_TASK_CONV_PREFIX = 'wstask-'

/**
 * Build the namespaced conversationId for a workspace task.
 */
export function getWorkspaceTaskConversationId(taskId: string): string {
  return `${WORKSPACE_TASK_CONV_PREFIX}${taskId}`
}

/**
 * Check whether a conversationId belongs to a workspace task.
 */
export function isWorkspaceTaskConversationId(convId: string): boolean {
  return convId.startsWith(WORKSPACE_TASK_CONV_PREFIX)
}
