/**
 * IPC: workspace text search / replace (find in files)
 */

import { ipcMain } from 'electron'
import {
  searchWorkspaceFiles,
  replaceAllInWorkspaceFiles,
} from '../services/workspace-search.service'
import type { WorkspaceSearchOptionsInput } from '../../shared/types/workspace-search'

export function registerWorkspaceSearchHandlers(): void {
  ipcMain.handle(
    'workspace-search:search',
    async (_event, spaceId: unknown, query: unknown, options?: WorkspaceSearchOptionsInput) => {
      if (typeof spaceId !== 'string' || typeof query !== 'string') {
        return { success: false, error: 'Invalid arguments' }
      }
      const result = searchWorkspaceFiles(spaceId, query, options)
      if (!result.ok) {
        return { success: false, error: result.error }
      }
      return { success: true, data: result.matches }
    }
  )

  ipcMain.handle(
    'workspace-search:replace-all',
    async (_event, spaceId: unknown, find: unknown, replace: unknown, options?: WorkspaceSearchOptionsInput) => {
      if (typeof spaceId !== 'string' || typeof find !== 'string' || typeof replace !== 'string') {
        return { success: false, error: 'Invalid arguments' }
      }
      const result = replaceAllInWorkspaceFiles(spaceId, find, replace, options)
      if (!result.ok) {
        return { success: false, error: result.error }
      }
      return { success: true, data: result.result }
    }
  )
}
