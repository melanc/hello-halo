/**
 * useFileOperations - Custom hook for file/folder operations
 * Extracted from ArtifactTree to follow Single Responsibility Principle
 */

import { useCallback, useRef } from 'react'
import { NodeApi } from 'react-arborist'
import { api } from '../api'
import { useNotificationStore } from '../stores/notification.store'
import { useTranslation } from '../i18n'
import type { ArtifactTreeNode } from '../types'

// Auto-cleanup timeout for path tracking (10 seconds)
const AUTO_CLEANUP_TIMEOUT = 10000

interface UseFileOperationsOptions {
  spaceId: string
}

export function useFileOperations({ spaceId }: UseFileOperationsOptions) {
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
    console.log('[trackPathForSelection]', path)
    const timestamp = Date.now()
    recentlyCreatedPaths.current.set(path, timestamp)
    
    // Clear existing timeout if any
    const existingTimeout = cleanupTimeouts.current.get(path)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    // Auto-cleanup after timeout
    const timeoutId = setTimeout(() => {
      const storedTimestamp = recentlyCreatedPaths.current.get(path)
      // Only delete if the timestamp matches (not replaced by a newer operation)
      if (storedTimestamp === timestamp) {
        recentlyCreatedPaths.current.delete(path)
        cleanupTimeouts.current.delete(path)
        console.log('[trackPathForSelection] Auto-cleanup:', path)
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
   * Create new file or folder
   */
  const createNewArtifact = useCallback(async (
    node: NodeApi<ArtifactTreeNode>,
    newName: string
  ) => {
    console.log('[createNewArtifact]', newName)
    
    // Get parent path
    const parentPath = node.parent?.data.path || ''
    const fullPath = parentPath ? `${parentPath}/${newName}` : newName
    
    // Update the temp node's name immediately for better UX
    node.data.name = newName
    node.reset()
    node.deselect()
    
    // Track for auto-selection
    trackPathForSelection(fullPath)
    
    // Determine if it's a folder or file
    const isFolder = !node.isLeaf
    
    try {
      const response = isFolder
        ? await api.createArtifactFolder(spaceId, fullPath)
        : await api.createArtifactFile(spaceId, fullPath, '')
      
      if (!response.success) {
        untrackPath(fullPath)
        showError(t('Failed to create'), response.error || t('Unknown error'))
      }
    } catch (error) {
      untrackPath(fullPath)
      console.error('[createNewArtifact] Failed:', error)
      showError(t('Failed to create'), (error as Error).message)
    }
  }, [spaceId, t, trackPathForSelection, untrackPath, showError])

  /**
   * Rename existing file or folder
   */
  const renameExistingArtifact = useCallback(async (
    node: NodeApi<ArtifactTreeNode>,
    newName: string
  ) => {
    const oldPath = node.data.path
    const oldName = node.data.name
    
    // If name unchanged, ignore
    if (newName === oldName) {
      console.log('[renameExistingArtifact] Name unchanged, ignoring')
      return
    }
    
    console.log('[renameExistingArtifact]', oldPath, '→', newName)
    
    // Calculate new path
    const parentPath = node.parent?.data.path || ''
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    
    // Track for auto-selection
    trackPathForSelection(newPath)
    
    try {
      const response = await api.renameArtifact(spaceId, oldPath, newName)
      
      if (!response.success) {
        untrackPath(newPath)
        showError(t('Failed to rename'), response.error || t('Unknown error'))
      }
    } catch (error) {
      untrackPath(newPath)
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
   * Move file or folder
   */
  const moveArtifact = useCallback(async (oldPath: string, newPath: string) => {
    try {
      const response = await api.moveArtifact(spaceId, oldPath, newPath)
      
      if (!response.success) {
        console.error('[moveArtifact] Move failed:', oldPath, '→', newPath, response.error)
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
