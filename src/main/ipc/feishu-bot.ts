/**
 * Feishu Bot IPC Handlers
 *
 * Provides status check functionality for the Settings UI.
 * Config CRUD is handled by the generic config IPC (config.ts saves feishuBot field).
 */

import { ipcMain } from 'electron'
import { getConfig } from '../services/config.service'
import { listSpaces, getDevXSpace } from '../services/space.service'
import { listConversations, listTaskConversations } from '../services/conversation.service'
import { getFeishuBotSource } from '../apps/runtime'
import { getPipelineStore } from '../pipeline'

export function registerFeishuBotHandlers(): void {
  // Get FeishuBot connection status
  ipcMain.handle('feishu-bot:status', async () => {
    try {
      const source = getFeishuBotSource()
      const config = getConfig().feishuBot
      return {
        success: true,
        data: {
          configured: !!(config?.appId && config?.appSecret),
          enabled: config?.enabled ?? false,
          connected: source?.isConnected() ?? false,
        }
      }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reconnect WebSocket with current config (called after saving settings)
  ipcMain.handle('feishu-bot:reconnect', async () => {
    try {
      const source = getFeishuBotSource()
      if (!source) {
        return { success: false, error: 'FeishuBotSource not initialized' }
      }
      source.reconnectWithConfig()
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // List all spaces for Feishu bot routing config
  ipcMain.handle('feishu-bot:list-spaces', async () => {
    try {
      const spaces = listSpaces()
      return {
        success: true,
        data: spaces.map(s => ({ id: s.id, name: s.name })),
      }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // List all pipeline tasks for Feishu bot routing config
  ipcMain.handle('feishu-bot:list-tasks', async () => {
    try {
      const store = getPipelineStore()
      if (!store) {
        return { success: false, error: 'Pipeline store not initialized' }
      }
      // Collect tasks from all spaces
      const spaces = listSpaces()
      const allTasks: Array<{
        id: string
        spaceId: string
        title: string
        createdAt: number
        updatedAt: number
      }> = []
      for (const space of spaces) {
        const tasks = store.listTasks(space.id)
        for (const task of tasks) {
          allTasks.push({
            id: task.id,
            spaceId: task.spaceId,
            title: task.title,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })
        }
      }
      // Sort newest first
      allTasks.sort((a, b) => b.updatedAt - a.updatedAt)
      return { success: true, data: allTasks }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // List all main (non-task) sessions across all spaces for Feishu bot routing
  ipcMain.handle('feishu-bot:list-main-sessions', async () => {
    try {
      const spaces = listSpaces()
      // Also include DevX space (halo-temp) since listSpaces() excludes it
      try { const d = getDevXSpace(); if (d && !spaces.find(s => s.id === d.id)) spaces.push(d) } catch {}
      const sessions: Array<{
        id: string
        spaceId: string
        spaceName: string
        title: string
        updatedAt: string
      }> = []
      for (const space of spaces) {
        try {
          const conversations = listConversations(space.id)
          for (const conv of conversations) {
            sessions.push({
              id: conv.id,
              spaceId: space.id,
              spaceName: space.name,
              title: conv.title || 'Feishu Bot',
              updatedAt: conv.updatedAt,
            })
          }
        } catch {
          // Skip spaces that fail
        }
      }
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return { success: true, data: sessions }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // List all task conversations (wstask-*) across all spaces for Feishu bot routing
  ipcMain.handle('feishu-bot:list-task-sessions', async () => {
    try {
      const spaces = listSpaces()
      // Also include DevX space (halo-temp) since listSpaces() excludes it
      try { const d = getDevXSpace(); if (d && !spaces.find(s => s.id === d.id)) spaces.push(d) } catch {}
      const pipelineStore = getPipelineStore()
      const sessions: Array<{
        id: string
        conversationId: string
        spaceId: string
        spaceName: string
        title: string
        taskId: string
        updatedAt: string
      }> = []
      for (const space of spaces) {
        try {
          const convs = listTaskConversations(space.id)
          for (const conv of convs) {
            const taskId = conv.id.startsWith('wstask-') ? conv.id.slice(7) : conv.id
            // Use the pipeline task name as the display title if available
            let title = conv.title
            if (pipelineStore) {
              try {
                const task = pipelineStore.getTask(taskId)
                if (task?.title) title = task.title
              } catch {}
            }
            sessions.push({
              id: conv.id,
              conversationId: conv.id,
              spaceId: space.id,
              spaceName: space.name,
              title,
              taskId,
              updatedAt: conv.updatedAt,
            })
          }
        } catch {
          // Skip spaces that fail
        }
      }
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return { success: true, data: sessions }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  console.log('[FeishuBot] IPC handlers registered')
}
