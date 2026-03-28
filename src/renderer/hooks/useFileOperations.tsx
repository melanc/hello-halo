/**
 * useFileOperations - Custom hook for file/folder operations
 * Extracted from ArtifactTree to follow Single Responsibility Principle
 *
 * Path construction is delegated to the backend — this hook sends
 * (parentPath, name) and receives the resolved absolute path in the response.
 */

import { useCallback, useRef, type MutableRefObject } from 'react'
import { NodeApi } from 'react-arborist'
import { api } from '../api'
import { useNotificationStore } from '../stores/notification.store'
import { useTranslation } from '../i18n'
import type { ArtifactTreeNode } from '../types'

// Auto-cleanup timeout for path tracking (10 seconds)
const AUTO_CLEANUP_TIMEOUT = 10000

interface UseFileOperationsOptions {
  spaceId: string
  /** Ref to the workspace root — read at call time, avoids stale closures */
  workspaceRootRef: MutableRefObject<string>
}

export interface CreateResult {
  success: boolean
  resolvedPath: string
}

export function useFileOperations({ spaceId, workspaceRootRef }: UseFileOperationsOptions) {
  const { t } = useTranslation()

  // Track recently created files for auto-selection (path -> timestamp mapping)
  // Entries are automatically cleaned up after 10 seconds to prevent memory leaks
  const recentlyCreatedPaths = useRef<Map<string, number>>(new Map())
  const cleanupTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map())

  /**
   * Show error notification
   */
  const showError = useCallback((title: string, error: string) => {
    useNotificationStore.getState().show({
      title,
      body: error,
      variant: 'error',
      duration: 3000
    })
  }, [])

  /**
   * Track path for auto-selection after file system operation
   * Automatically cleans up after timeout to prevent memory leaks
   */
  const trackPathForSelection = useCallback((path: string) => {
    const timestamp = Date.now()
    recentlyCreatedPaths.current.set(path, timestamp)

    const existingTimeout = cleanupTimeouts.current.get(path)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeoutId = setTimeout(() => {
      if (recentlyCreatedPaths.current.get(path) === timestamp) {
        recentlyCreatedPaths.current.delete(path)
        cleanupTimeouts.current.delete(path)
      }
    }, AUTO_CLEANUP_TIMEOUT)

    cleanupTimeouts.current.set(path, timeoutId)
  }, [])

  /**
   * Untrack path if operation failed
   */
  const untrackPath = useCallback((path: string) => {
    recentlyCreatedPaths.current.delete(path)
    // Clear timeout to prevent memory leak
    const timeoutId = cleanupTimeouts.current.get(path)
    if (timeoutId) {
      clearTimeout(timeoutId)
      cleanupTimeouts.current.delete(path)
    }
  }, [])

  /**
   * Resolve parent path for a node.
   * For root-level nodes (parent is arborist internal root), returns empty string
   * so the backend falls back to workspaceRoot.
   * For nodes whose parent has a temp path, returns empty string (same fallback).
   */
  const getParentPath = useCallback((node: NodeApi<ArtifactTreeNode>): string => {
    const parentPath = node.parent?.data.path || ''
    // If parent path is a temp placeholder, the real directory may not exist yet on disk.
    // Send empty string so the backend uses workspaceRoot as the parent.
    if (!parentPath || parentPath.startsWith('temp-')) return ''
    return parentPath
  }, [])

  /**
   * Create new file or folder.
   * Sends (parentPath, name) to backend; backend constructs the full path.
   * Returns the resolved absolute path on success so the caller can update tree state.
   */
  const createNewArtifact = useCallback(async (
    node: NodeApi<ArtifactTreeNode>,
    newName: string
  ): Promise<CreateResult> => {
    const parentPath = getParentPath(node)

    // Update temp node name immediately for responsive UX
    node.data.name = newName
    node.reset()
    node.deselect()

    // Optimistic path for tracking — backend will return the real one
    const wsRoot = workspaceRootRef.current
    const optimisticPath = parentPath ? `${parentPath}/${newName}` : `${wsRoot}/${newName}`
    trackPathForSelection(optimisticPath)

    // Determine if it's a folder or file
    const isFolder = !node.isLeaf

    try {
      const response = isFolder
        ? await api.createArtifactFolder(spaceId, parentPath, newName)
        : await api.createArtifactFile(spaceId, parentPath, newName, '')

      if (!response.success) {
        untrackPath(optimisticPath)
        showError(t('Failed to create'), response.error || t('Unknown error'))
        return { success: false, resolvedPath: '' }
      }

      // Backend returns the resolved absolute path
      const resolvedPath = (response.data as { path: string })?.path || optimisticPath

      // If the resolved path differs from our optimistic guess, update tracking
      if (resolvedPath !== optimisticPath) {
        untrackPath(optimisticPath)
        trackPathForSelection(resolvedPath)
      }

      return { success: true, resolvedPath }
    } catch (error) {
      untrackPath(optimisticPath)
      console.error('[createNewArtifact] Failed:', error)
      showError(t('Failed to create'), (error as Error).message)
      return { success: false, resolvedPath: '' }
    }
  }, [spaceId, t, getParentPath, trackPathForSelection, untrackPath, showError])

  /**
   * Rename existing file or folder
   */
  const renameExistingArtifact = useCallback(async (
    node: NodeApi<ArtifactTreeNode>,
    newName: string
  ) => {
    const oldPath = node.data.path
    const oldName = node.data.name

    if (newName === oldName) return

    // Track the expected new path for auto-selection
    // Rename API already handles path construction on the backend (dirname(oldPath) + newName)
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || oldPath.substring(0, oldPath.lastIndexOf('\\'))
    const expectedNewPath = parentDir ? `${parentDir}/${newName}` : newName
    trackPathForSelection(expectedNewPath)

    try {
      const response = await api.renameArtifact(spaceId, oldPath, newName)

      if (!response.success) {
        untrackPath(expectedNewPath)
        showError(t('Failed to rename'), response.error || t('Unknown error'))
      }
    } catch (error) {
      untrackPath(expectedNewPath)
      console.error('[renameExistingArtifact] Failed:', error)
      showError(t('Failed to rename'), (error as Error).message)
    }
  }, [spaceId, t, trackPathForSelection, untrackPath, showError])

  /**
   * Delete file or folder
   */
  const deleteArtifact = useCallback(async (path: string) => {
    try {
      const response = await api.deleteArtifact(spaceId, path)
      if (!response.success) {
        console.error('[deleteArtifact] Failed to delete:', path, response.error)
        return false
      }
      return true
    } catch (error) {
      console.error('[deleteArtifact] Delete error:', path, error)
      return false
    }
  }, [spaceId])

  /**
   * Move file or folder — sends (oldPath, newParentPath), backend constructs destination
   */
  const moveArtifact = useCallback(async (oldPath: string, newParentPath: string) => {
    try {
      const response = await api.moveArtifact(spaceId, oldPath, newParentPath)

      if (!response.success) {
        console.error('[moveArtifact] Move failed:', oldPath, '→', newParentPath, response.error)
        showError(t('Move failed'), response.error || t('Unknown error'))
        return false
      }
      return true
    } catch (error) {
      console.error('[moveArtifact] Move error:', error)
      showError(t('Move failed'), (error as Error).message)
      return false
    }
  }, [spaceId, t, showError])

  /**
   * Cleanup all pending timeouts (call on unmount)
   */
  const cleanup = useCallback(() => {
    cleanupTimeouts.current.forEach(timeoutId => clearTimeout(timeoutId))
    cleanupTimeouts.current.clear()
    recentlyCreatedPaths.current.clear()
  }, [])

  return {
    createNewArtifact,
    renameExistingArtifact,
    deleteArtifact,
    moveArtifact,
    recentlyCreatedPaths,
    cleanup
  }
}
