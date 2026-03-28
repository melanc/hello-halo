/**
 * Artifact IPC Handlers - Handle artifact-related requests from renderer
 *
 * PERFORMANCE OPTIMIZED:
 * - Uses async functions for non-blocking I/O
 * - Supports lazy loading for tree view
 * - Provides incremental updates via file watcher events
 */

import { ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import {
  listArtifacts,
  listArtifactsTree,
  loadTreeChildren,
  initArtifactWatcher,
  readArtifactContent,
  saveArtifactContent,
  detectFileType
} from '../services/artifact.service'

// Register all artifact handlers
export function registerArtifactHandlers(): void {
  // List artifacts in a space (flat list for card view)
  ipcMain.handle('artifact:list', async (_event, spaceId: string) => {
    try {
      const artifacts = await listArtifacts(spaceId)
      return { success: true, data: artifacts }
    } catch (error) {
      console.error('[IPC] artifact:list error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // List artifacts as tree structure (for developer view)
  ipcMain.handle('artifact:list-tree', async (_event, spaceId: string) => {
    try {
      const tree = await listArtifactsTree(spaceId)
      return { success: true, data: tree }
    } catch (error) {
      console.error('[IPC] artifact:list-tree error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Load children for lazy tree expansion
  ipcMain.handle('artifact:load-children', async (_event, spaceId: string, dirPath: string) => {
    try {
      console.log(`[IPC] artifact:load-children - spaceId: ${spaceId}, path: ${dirPath}`)
      const children = await loadTreeChildren(spaceId, dirPath)
      return { success: true, data: children }
    } catch (error) {
      console.error('[IPC] artifact:load-children error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Initialize file watcher for a space
  ipcMain.handle('artifact:init-watcher', async (_event, spaceId: string) => {
    try {
      console.log(`[IPC] artifact:init-watcher - spaceId: ${spaceId}`)
      await initArtifactWatcher(spaceId)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:init-watcher error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Open file or folder with system default application
  ipcMain.handle('artifact:open', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:open - path: ${filePath}`)
      // shell.openPath opens file with default app, or folder with file manager
      const error = await shell.openPath(filePath)
      if (error) {
        console.error('[IPC] artifact:open error:', error)
        return { success: false, error }
      }
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:open error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Show file in folder (highlight in file manager)
  ipcMain.handle('artifact:show-in-folder', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:show-in-folder - path: ${filePath}`)
      // shell.showItemInFolder opens the folder and selects the file
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:show-in-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Read file content for Content Canvas
  ipcMain.handle('artifact:read-content', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:read-content - path: ${filePath}`)
      const content = await readArtifactContent(filePath)
      return { success: true, data: content }
    } catch (error) {
      console.error('[IPC] artifact:read-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Save file content from Content Canvas (edit mode)
  ipcMain.handle('artifact:save-content', async (_event, filePath: string, content: string) => {
    try {
      console.log(`[IPC] artifact:save-content - path: ${filePath}`)
      await saveArtifactContent(filePath, content)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:save-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Detect file type for Canvas viewability
  // Used by renderer to determine if unknown file types can be opened in Canvas
  ipcMain.handle('artifact:detect-file-type', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:detect-file-type - path: ${filePath}`)
      const fileTypeInfo = await detectFileType(filePath)
      return { success: true, data: fileTypeInfo }
    } catch (error) {
      console.error('[IPC] artifact:detect-file-type error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // ===== File Operations (Create, Rename, Delete, Move) =====

  /**
   * Ensure parent directory exists for a given file path
   * @param filePath - Absolute file path
   */
  async function ensureParentDir(filePath: string): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true })
  }

  /**
   * Check if a path already exists
   * @param path - Absolute path to check
   * @returns true if exists, false otherwise
   */
  async function pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }

  // Create file
  ipcMain.handle('artifact:create-file', async (_event, spaceId: string, filePath: string, content: string = '') => {
    try {
      console.log(`[IPC] artifact:create-file - spaceId: ${spaceId}, path: ${filePath}`)
      
      // Ensure parent directory exists
      await ensureParentDir(filePath)
      
      // Create file
      await fs.writeFile(filePath, content, 'utf-8')
      
      console.log(`[IPC] artifact:create-file success: ${filePath}`)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:create-file error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Create folder
  ipcMain.handle('artifact:create-folder', async (_event, spaceId: string, folderPath: string) => {
    try {
      console.log(`[IPC] artifact:create-folder - spaceId: ${spaceId}, path: ${folderPath}`)
      
      await fs.mkdir(folderPath, { recursive: true })
      
      console.log(`[IPC] artifact:create-folder success: ${folderPath}`)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:create-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Delete file or folder (recursive)
  ipcMain.handle('artifact:delete', async (_event, spaceId: string, targetPath: string) => {
    try {
      console.log(`[IPC] artifact:delete - spaceId: ${spaceId}, path: ${targetPath}`)
      
      await fs.rm(targetPath, { recursive: true, force: true })
      
      console.log(`[IPC] artifact:delete success: ${targetPath}`)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:delete error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Rename file or folder
  ipcMain.handle('artifact:rename', async (_event, spaceId: string, oldPath: string, newName: string) => {
    try {
      console.log(`[IPC] artifact:rename - spaceId: ${spaceId}, oldPath: ${oldPath}, newName: ${newName}`)
      
      const newFullPath = join(dirname(oldPath), newName)
      
      // Check if target already exists
      if (await pathExists(newFullPath)) {
        return { success: false, error: 'File or folder already exists' }
      }
      
      await fs.rename(oldPath, newFullPath)
      
      console.log(`[IPC] artifact:rename success: ${oldPath} -> ${newFullPath}`)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:rename error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Move file or folder
  ipcMain.handle('artifact:move', async (_event, spaceId: string, oldPath: string, newPath: string) => {
    try {
      console.log(`[IPC] artifact:move - spaceId: ${spaceId}, oldPath: ${oldPath}, newPath: ${newPath}`)
      
      // Ensure target directory exists
      await ensureParentDir(newPath)
      
      // Check if target already exists
      if (await pathExists(newPath)) {
        return { success: false, error: 'Target already exists' }
      }
      
      await fs.rename(oldPath, newPath)
      
      console.log(`[IPC] artifact:move success: ${oldPath} -> ${newPath}`)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:move error:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
