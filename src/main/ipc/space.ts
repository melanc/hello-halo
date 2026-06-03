/**
 * Space IPC Handlers
 */

import { ipcMain, dialog } from 'electron'
import { existsSync, readdirSync, watch, readFileSync, type FSWatcher } from 'fs'
import { sendToRenderer } from '../services/window.service'
import {
  getDevXSpace,
  listSpaces,
  createSpace,
  deleteSpace,
  getSpaceWithPreferences,
  openSpaceFolder,
  updateSpace,
  updateSpacePreferences,
  getSpacePreferences
} from '../services/space.service'
import { getSpacesDir } from '../services/config.service'

// Import types for preferences
interface SpaceLayoutPreferences {
  artifactRailExpanded?: boolean
  chatWidth?: number
}

interface SpacePreferences {
  layout?: SpaceLayoutPreferences
}

export function registerSpaceHandlers(): void {
  // Get default (temp) workspace space
  ipcMain.handle('space:get-devx', async () => {
    try {
      const space = getDevXSpace()
      console.log('[SpaceIPC] space:get-devx response: id=%s', space?.id)
      return { success: true, data: space }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[SpaceIPC] space:get-devx error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // List all spaces
  ipcMain.handle('space:list', async () => {
    try {
      const spaces = listSpaces()
      console.log('[SpaceIPC] space:list response: count=%d', spaces.length)
      return { success: true, data: spaces }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[SpaceIPC] space:list error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Create a new space
  ipcMain.handle(
    'space:create',
    async (_event, input: { name: string; icon: string; customPath?: string }) => {
      try {
        const space = createSpace(input)
        return { success: true, data: space }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Delete a space
  ipcMain.handle('space:delete', async (_event, spaceId: string) => {
    try {
      const result = await deleteSpace(spaceId)
      return { success: true, data: result }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get a specific space (with preferences for UI)
  ipcMain.handle('space:get', async (_event, spaceId: string) => {
    try {
      const space = getSpaceWithPreferences(spaceId)
      return { success: true, data: space }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Open space folder
  ipcMain.handle('space:open-folder', async (_event, spaceId: string) => {
    try {
      const result = openSpaceFolder(spaceId)
      return { success: true, data: result }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update space
  ipcMain.handle(
    'space:update',
    async (_event, spaceId: string, updates: { name?: string; icon?: string }) => {
      try {
        const space = updateSpace(spaceId, updates)
        return { success: true, data: space }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Get default space path
  ipcMain.handle('space:get-default-path', async () => {
    try {
      const spacesDir = getSpacesDir()
      return { success: true, data: spacesDir }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Select folder dialog (for custom space location)
  ipcMain.handle('dialog:select-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Space Location',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Select Folder'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }

      return { success: true, data: result.filePaths[0] }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update space preferences (layout settings)
  ipcMain.handle(
    'space:update-preferences',
    async (_event, spaceId: string, preferences: Partial<SpacePreferences>) => {
      try {
        const space = updateSpacePreferences(spaceId, preferences)
        return { success: true, data: space }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Get space preferences
  ipcMain.handle('space:get-preferences', async (_event, spaceId: string) => {
    try {
      const preferences = getSpacePreferences(spaceId)
      return { success: true, data: preferences }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Check if a filesystem path exists
  ipcMain.handle('fs:path-exists', (_event, fsPath: string) => {
    try {
      return { success: true, exists: existsSync(fsPath) }
    } catch {
      return { success: true, exists: false }
    }
  })

  // List directory contents at an arbitrary path (for external project dirs)
  ipcMain.handle('fs:readdir', async (_event, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      return {
        success: true,
        data: entries
          .filter(e => !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          }),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── File watching (individual files) ──────────────────────────────
  const fileWatchers = new Map<string, FSWatcher>()

  // Watch a file for external changes and push new content to renderer
  ipcMain.handle('fs:watch-file', async (_event, filePath: string) => {
    try {
      // Close existing watcher if any
      const existing = fileWatchers.get(filePath)
      if (existing) {
        existing.close()
      }

      const watcher = watch(filePath, (eventType) => {
        if (eventType !== 'change') return

        // Debounce: read and send after a short delay
        // fs.watch may fire multiple times for a single save
        setTimeout(() => {
          try {
            const content = readFileSync(filePath, 'utf-8')
            sendToRenderer('fs:file-changed', { path: filePath, content })
          } catch {
            // File may be temporarily locked or deleted
          }
        }, 100)
      })

      fileWatchers.set(filePath, watcher)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Stop watching a file
  ipcMain.handle('fs:unwatch-file', async (_event, filePath: string) => {
    try {
      const watcher = fileWatchers.get(filePath)
      if (watcher) {
        watcher.close()
        fileWatchers.delete(filePath)
      }
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
