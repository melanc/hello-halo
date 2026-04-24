/**
 * IPC — Source control panel (simple-git, workspace-scoped).
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import {
  gitWorkspaceStatus,
  gitWorkspaceDiff,
  gitWorkspaceStage,
  gitWorkspaceStageAll,
  gitWorkspaceUnstage,
  gitWorkspaceUnstageAll,
  gitWorkspaceCommit,
  gitWorkspaceDiscardWorking,
  gitProjectDirStatus,
  gitProjectDirDiff,
  gitProjectDirStage,
  gitProjectDirUnstage,
  gitProjectDirCommit,
  gitProjectDirDiscardWorking,
  gitWorkspaceBranchList,
  gitWorkspaceCheckoutBranch,
  gitWorkspaceDeleteBranch,
  gitWorkspaceCreateBranch,
  gitProjectDirBranchList,
  gitProjectDirCheckoutBranch,
  gitProjectDirDeleteBranch,
  gitProjectDirCreateBranch,
} from '../services/git-workspace.service'

export function registerGitWorkspaceHandlers(): void {
  ipcMain.handle('git-workspace:status', async (_event, spaceId: string) => {
    try {
      if (typeof spaceId !== 'string' || !spaceId) {
        return { success: false, error: 'Invalid space' }
      }
      const data = await gitWorkspaceStatus(spaceId)
      return { success: true, data }
    } catch (error) {
      console.error('[IPC] git-workspace:status error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'git-workspace:diff',
    async (_event, spaceId: string, relativePath: string, view: 'staged' | 'unstaged') => {
      try {
        if (typeof spaceId !== 'string' || typeof relativePath !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        if (view !== 'staged' && view !== 'unstaged') {
          return { success: false, error: 'Invalid view' }
        }
        const data = await gitWorkspaceDiff(spaceId, relativePath, view)
        return { success: true, data }
      } catch (error) {
        console.error('[IPC] git-workspace:diff error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('git-workspace:stage', async (_event, spaceId: string, paths: string[]) => {
    try {
      if (typeof spaceId !== 'string' || !Array.isArray(paths)) {
        return { success: false, error: 'Invalid request' }
      }
      await gitWorkspaceStage(spaceId, paths)
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:stage error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('git-workspace:stage-all', async (_event, spaceId: string) => {
    try {
      if (typeof spaceId !== 'string') {
        return { success: false, error: 'Invalid request' }
      }
      await gitWorkspaceStageAll(spaceId)
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:stage-all error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('git-workspace:unstage', async (_event, spaceId: string, paths: string[]) => {
    try {
      if (typeof spaceId !== 'string' || !Array.isArray(paths)) {
        return { success: false, error: 'Invalid request' }
      }
      await gitWorkspaceUnstage(spaceId, paths)
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:unstage error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('git-workspace:unstage-all', async (_event, spaceId: string) => {
    try {
      if (typeof spaceId !== 'string') {
        return { success: false, error: 'Invalid request' }
      }
      await gitWorkspaceUnstageAll(spaceId)
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:unstage-all error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'git-workspace:commit',
    async (_event, spaceId: string, message: string, amend?: boolean) => {
      try {
        if (typeof spaceId !== 'string' || typeof message !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        await gitWorkspaceCommit(spaceId, message, !!amend)
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:commit error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:project-status',
    async (_event, spaceId: string, topLevelDir: string) => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        const data = await gitProjectDirStatus(spaceId, topLevelDir)
        return { success: true, data }
      } catch (error) {
        console.error('[IPC] git-workspace:project-status error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:project-diff',
    async (_event, spaceId: string, topLevelDir: string, relativePath: string, view: 'staged' | 'unstaged') => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string' || typeof relativePath !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        if (view !== 'staged' && view !== 'unstaged') {
          return { success: false, error: 'Invalid view' }
        }
        const data = await gitProjectDirDiff(spaceId, topLevelDir, relativePath, view)
        return { success: true, data }
      } catch (error) {
        console.error('[IPC] git-workspace:project-diff error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:project-stage',
    async (_event, spaceId: string, topLevelDir: string, paths: string[]) => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string' || !Array.isArray(paths)) {
          return { success: false, error: 'Invalid request' }
        }
        await gitProjectDirStage(spaceId, topLevelDir, paths)
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:project-stage error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:project-unstage',
    async (_event, spaceId: string, topLevelDir: string, paths: string[]) => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string' || !Array.isArray(paths)) {
          return { success: false, error: 'Invalid request' }
        }
        await gitProjectDirUnstage(spaceId, topLevelDir, paths)
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:project-unstage error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:project-commit',
    async (_event, spaceId: string, topLevelDir: string, message: string, amend?: boolean) => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string' || typeof message !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        await gitProjectDirCommit(spaceId, topLevelDir, message, !!amend)
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:project-commit error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('git-workspace:discard-working', async (_event, spaceId: string, paths: string[]) => {
    try {
      if (typeof spaceId !== 'string' || !Array.isArray(paths)) {
        return { success: false, error: 'Invalid request' }
      }
      await gitWorkspaceDiscardWorking(spaceId, paths)
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:discard-working error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'git-workspace:project-discard-working',
    async (_event, spaceId: string, topLevelDir: string, paths: string[]) => {
      try {
        if (typeof spaceId !== 'string' || typeof topLevelDir !== 'string' || !Array.isArray(paths)) {
          return { success: false, error: 'Invalid request' }
        }
        await gitProjectDirDiscardWorking(spaceId, topLevelDir, paths)
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:project-discard-working error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Optional `topLevelDir` scopes branch ops to a task project folder (same channels as workspace).
  ipcMain.handle('git-workspace:branch-list', async (_event, spaceId: string, topLevelDir?: string) => {
    try {
      if (typeof spaceId !== 'string' || !spaceId) {
        return { success: false, error: 'Invalid space' }
      }
      const data =
        typeof topLevelDir === 'string' && topLevelDir
          ? await gitProjectDirBranchList(spaceId, topLevelDir)
          : await gitWorkspaceBranchList(spaceId)
      return { success: true, data }
    } catch (error) {
      console.error('[IPC] git-workspace:branch-list error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'git-workspace:checkout-branch',
    async (_event, spaceId: string, branch: string, topLevelDir?: string) => {
      try {
        if (typeof spaceId !== 'string' || typeof branch !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        if (typeof topLevelDir === 'string' && topLevelDir) {
          await gitProjectDirCheckoutBranch(spaceId, topLevelDir, branch)
        } else {
          await gitWorkspaceCheckoutBranch(spaceId, branch)
        }
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:checkout-branch error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:delete-branch',
    async (_event, spaceId: string, branch: string, force?: boolean, topLevelDir?: string) => {
      try {
        if (typeof spaceId !== 'string' || typeof branch !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        if (typeof topLevelDir === 'string' && topLevelDir) {
          await gitProjectDirDeleteBranch(spaceId, topLevelDir, branch, !!force)
        } else {
          await gitWorkspaceDeleteBranch(spaceId, branch, !!force)
        }
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:delete-branch error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'git-workspace:create-branch',
    async (_event, spaceId: string, name: string, topLevelDir?: string) => {
      try {
        if (typeof spaceId !== 'string' || typeof name !== 'string') {
          return { success: false, error: 'Invalid request' }
        }
        if (typeof topLevelDir === 'string' && topLevelDir) {
          await gitProjectDirCreateBranch(spaceId, topLevelDir, name)
        } else {
          await gitWorkspaceCreateBranch(spaceId, name)
        }
        return { success: true }
      } catch (error) {
        console.error('[IPC] git-workspace:create-branch error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Open a dedicated Git panel window
  ipcMain.handle('git-workspace:open-window', async (_event, { spaceId, title }: { spaceId: string; title?: string }) => {
    try {
      const win = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 720,
        minHeight: 480,
        title: title || 'Git',
        webPreferences: {
          preload: join(__dirname, '../preload/index.mjs'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      const isDev = !app.isPackaged
      if (isDev && process.env['ELECTRON_RENDERER_URL']) {
        await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=git&spaceId=${encodeURIComponent(spaceId)}`)
      } else {
        await win.loadFile(join(__dirname, '../renderer/index.html'), {
          query: { mode: 'git', spaceId },
        })
      }
      return { success: true }
    } catch (error) {
      console.error('[IPC] git-workspace:open-window error:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
