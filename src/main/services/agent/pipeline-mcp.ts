/**
 * Agent Module - Pipeline MCP Server
 *
 * Provides the `announce_file_changes` tool, which pauses agent execution
 * and shows the user a confirmation dialog listing all planned file modifications.
 * The agent must call this tool before making any file edits in the coding phase.
 */

import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { emitAgentEvent } from './events'

// ============================================
// Pending Confirmations Registry
// ============================================

interface PendingConfirmationEntry {
  resolve: (confirmed: boolean) => void
  reject: (reason?: unknown) => void
}

/** Map of confirmation ID -> Promise handlers. Module-level for IPC handler access. */
const pendingConfirmations = new Map<string, PendingConfirmationEntry>()

/**
 * Resolve a pending file-change confirmation with the user's decision.
 * Called by IPC handler when user clicks Confirm or Cancel.
 */
export function resolvePipelineConfirmation(id: string, confirmed: boolean): boolean {
  const entry = pendingConfirmations.get(id)
  if (!entry) {
    console.warn(`[PipelineMcp] No pending confirmation for id: ${id}`)
    return false
  }
  entry.resolve(confirmed)
  pendingConfirmations.delete(id)
  return true
}

/**
 * Reject all pending confirmations (e.g., generation stopped).
 */
export function rejectAllPipelineConfirmations(): void {
  for (const [id, entry] of pendingConfirmations) {
    entry.reject(new Error('Generation stopped'))
    pendingConfirmations.delete(id)
  }
}

// ============================================
// Tool Definition
// ============================================

function buildAnnounceFileChangesTool(spaceId: string, conversationId: string, abortSignal: AbortSignal) {
  return tool(
    'announce_file_changes',
    `Announce planned file modifications and wait for user confirmation before proceeding.

Call this tool ONCE before making any file edits in the coding phase. List every file you plan to modify, along with the reason for each change. The user will review the list and either confirm or cancel.

- If the user confirms: proceed with the file modifications as planned.
- If the tool returns an error (user cancelled): stop all file editing immediately and report back to the user.

You must call this tool before the first Edit or Write tool call. Do not skip it.`,
    {
      files: z.array(
        z.object({
          path: z.string().describe('File path to be modified'),
          reason: z.string().describe('Brief reason for modifying this file'),
        })
      ).describe('List of files planned for modification'),
    },
    async (args) => {
      const id = `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      console.log(`[PipelineMcp] announce_file_changes: id=${id}, files=${args.files.length}`)

      const confirmedPromise = new Promise<boolean>((resolve, reject) => {
        pendingConfirmations.set(id, { resolve, reject })

        // Auto-reject on generation abort
        if (abortSignal.aborted) {
          pendingConfirmations.delete(id)
          reject(new Error('Aborted'))
          return
        }
        const onAbort = () => {
          if (pendingConfirmations.has(id)) {
            pendingConfirmations.delete(id)
            reject(new Error('Aborted'))
          }
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })

      // Emit event so renderer shows the confirmation dialog
      emitAgentEvent('agent:announce-file-changes', spaceId, conversationId, {
        id,
        files: args.files,
      })

      try {
        const confirmed = await confirmedPromise
        if (confirmed) {
          console.log(`[PipelineMcp] File changes confirmed: id=${id}`)
          return {
            content: [{ type: 'text' as const, text: 'User confirmed. Proceed with file modifications.' }],
          }
        } else {
          console.log(`[PipelineMcp] File changes cancelled by user: id=${id}`)
          return {
            content: [{ type: 'text' as const, text: 'User cancelled. Do not make any file modifications. Report back to the user.' }],
            isError: true,
          }
        }
      } catch (error) {
        console.log(`[PipelineMcp] File changes aborted: id=${id}`)
        return {
          content: [{ type: 'text' as const, text: 'Operation aborted. Do not make any file modifications.' }],
          isError: true,
        }
      }
    }
  )
}

// ============================================
// MCP Server Factory
// ============================================

/**
 * Create the Pipeline MCP Server.
 *
 * Registers `announce_file_changes` so the agent can present planned file
 * modifications to the user and wait for confirmation before editing.
 *
 * Must be added to mcpServers as 'halo-pipeline' in send-message.ts and session-manager.ts.
 */
export function createPipelineMcpServer(spaceId: string, conversationId: string, abortSignal: AbortSignal) {
  return createSdkMcpServer({
    name: 'halo-pipeline',
    version: '1.0.0',
    tools: [buildAnnounceFileChangesTool(spaceId, conversationId, abortSignal)],
  })
}
