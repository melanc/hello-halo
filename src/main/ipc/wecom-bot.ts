/**
 * WeCom Bot IPC Handlers
 *
 * Provides status check and reconnect functionality for the Settings UI.
 * Config CRUD is handled by the generic config IPC (config.ts saves wecomBot field).
 */

import { ipcMain } from 'electron'
import { getConfig } from '../services/config.service'
import { getWecomBotSource } from '../apps/runtime'

export function registerWecomBotHandlers(): void {
  // Get WecomBot connection status
  ipcMain.handle('wecom-bot:status', async () => {
    try {
      const source = getWecomBotSource()
      const config = getConfig().wecomBot
      return {
        success: true,
        data: {
          configured: !!(config?.botId && config?.secret),
          enabled: config?.enabled ?? false,
          connected: source?.isConnected() ?? false,
        }
      }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reconnect WebSocket with current config (called after saving settings)
  ipcMain.handle('wecom-bot:reconnect', async () => {
    try {
      const source = getWecomBotSource()
      if (!source) {
        return { success: false, error: 'WecomBotSource not initialized' }
      }
      source.reconnectWithConfig()
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  console.log('[WecomBot] IPC handlers registered')
}
