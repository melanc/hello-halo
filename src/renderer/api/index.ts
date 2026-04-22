/**
 * DevX API - Unified interface for both IPC and HTTP modes
 * Automatically selects the appropriate transport
 */

import {
  isElectron,
  isCapacitor,
  httpRequest,
  onEvent,
  connectWebSocket,
  disconnectWebSocket,
  forceReconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,
  setAuthToken,
  clearAuthToken,
  getAuthToken,
  setServerUrl,
  getServerUrl,
  restoreServerUrl,
  clearServerUrl,
  clearPendingServerUrl,
  onWsStateChange
} from './transport'
import type {
  HealthStatusResponse,
  HealthStateResponse,
  HealthRecoveryResponse,
  HealthReportResponse,
  HealthExportResponse,
  HealthCheckResponse
} from '../../shared/types'
import type {
  GitWorkspaceStatusData,
  GitWorkspaceDiffData,
  GitBranchListData,
} from '../types/git-workspace'
import type {
  WorkspaceSearchMatch,
  WorkspaceSearchOptionsInput,
  WorkspaceReplaceAllResult,
} from '../../shared/types/workspace-search'

// Response type
interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * API object - drop-in replacement for window.devx
 * Works in both Electron and remote web mode
 */
export const api = {
  // ===== Authentication (remote only) =====
  isRemoteMode: () => !isElectron(),
  isCapacitorMode: () => isCapacitor(),
  isAuthenticated: () => !!getAuthToken(),

  login: async (token: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return { success: true }
    }

    const result = await httpRequest<void>('POST', '/api/remote/login', { token })
    if (result.success) {
      setAuthToken(token)
      connectWebSocket()
    }
    return result
  },

  logout: () => {
    clearAuthToken()
    disconnectWebSocket()
  },

  // ===== Generic Auth (provider-agnostic) =====
  authGetProviders: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authGetProviders()
    }
    return httpRequest('GET', '/api/auth/providers')
  },

  authStartLogin: async (providerType: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authStartLogin(providerType)
    }
    return httpRequest('POST', '/api/auth/start-login', { providerType })
  },

  authOpenLoginWindow: async (providerType: string, loginUrl: string, redirectUri: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authOpenLoginWindow(providerType, loginUrl, redirectUri)
    }
    // Web mode: not supported, fall back to completing with URL
    return { success: false, error: 'Login window not supported in web mode' }
  },

  authCompleteLogin: async (providerType: string, state: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authCompleteLogin(providerType, state)
    }
    return httpRequest('POST', '/api/auth/complete-login', { providerType, state })
  },

  authRefreshToken: async (providerType: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authRefreshToken(providerType)
    }
    return httpRequest('POST', '/api/auth/refresh-token', { providerType })
  },

  authCheckToken: async (providerType: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authCheckToken(providerType)
    }
    return httpRequest('GET', `/api/auth/check-token?providerType=${providerType}`)
  },

  authLogout: async (providerType: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.authLogout(providerType)
    }
    return httpRequest('POST', '/api/auth/logout', { providerType })
  },

  onAuthLoginProgress: (callback: (data: { provider: string; status: string }) => void) =>
    onEvent('auth:login-progress', callback),

  // ===== Config =====
  getConfig: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getConfig()
    }
    return httpRequest('GET', '/api/config')
  },

  setConfig: async (updates: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.setConfig(updates)
    }
    return httpRequest('POST', '/api/config', updates)
  },

  offlineSpeechStatus: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.offlineSpeechStatus()
    }
    return { success: false, error: 'not-electron' }
  },

  offlineSpeechTranscribe: async (payload: {
    wavBytes: ArrayBuffer
    i18nLanguage: string
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.offlineSpeechTranscribe(payload)
    }
    return { success: false, error: 'not-electron' }
  },

  offlineSpeechBrowseFile: async (opts?: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.offlineSpeechBrowseFile(opts)
    }
    return { success: false, error: 'not-electron' }
  },

  validateApi: async (
    apiKey: string,
    apiUrl: string,
    provider: string,
    model?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.validateApi(apiKey, apiUrl, provider, model)
    }
    return httpRequest('POST', '/api/config/validate', { apiKey, apiUrl, provider, model })
  },

  fetchModels: async (
    apiKey: string,
    apiUrl: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.fetchModels(apiKey, apiUrl)
    }
    return httpRequest('POST', '/api/config/fetch-models', { apiKey, apiUrl })
  },

  refreshAISourcesConfig: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.refreshAISourcesConfig()
    }
    return httpRequest('POST', '/api/config/refresh-ai-sources')
  },

  // ===== AI Sources CRUD (atomic - backend reads from disk, never overwrites rotating tokens) =====
  aiSourcesSwitchSource: async (sourceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.aiSourcesSwitchSource(sourceId)
    }
    return httpRequest('POST', '/api/ai-sources/switch-source', { sourceId })
  },

  aiSourcesSetModel: async (modelId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.aiSourcesSetModel(modelId)
    }
    return httpRequest('POST', '/api/ai-sources/set-model', { modelId })
  },

  aiSourcesAddSource: async (source: unknown): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.aiSourcesAddSource(source)
    }
    return httpRequest('POST', '/api/ai-sources/sources', source as Record<string, unknown>)
  },

  aiSourcesUpdateSource: async (sourceId: string, updates: unknown): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.aiSourcesUpdateSource(sourceId, updates)
    }
    return httpRequest('PUT', `/api/ai-sources/sources/${sourceId}`, updates as Record<string, unknown>)
  },

  aiSourcesDeleteSource: async (sourceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.aiSourcesDeleteSource(sourceId)
    }
    return httpRequest('DELETE', `/api/ai-sources/sources/${sourceId}`)
  },

  // ===== CLI Config (desktop-only) =====
  cliConfigGetPaths: async (): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigGetPaths()
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  cliConfigScanSkills: async (): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigScanSkills()
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  cliConfigMigrateSkills: async (
    actions: Array<{ name: string; action: 'skip' | 'overwrite' | 'rename' }>
  ): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigMigrateSkills(actions)
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  cliConfigScanMcp: async (): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigScanMcp()
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  cliConfigMigrateMcp: async (
    actions: Array<{ name: string; action: 'skip' | 'overwrite' }>
  ): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigMigrateMcp(actions)
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  cliConfigSetConfigDir: async (
    mode: 'halo' | 'cc' | 'custom',
    customDir?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.cliConfigSetConfigDir(mode, customDir)
    return { success: false, error: 'CLI config not available in remote mode' }
  },

  // ===== Space =====
  getDevXSpace: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getDevXSpace()
    }
    return httpRequest('GET', '/api/spaces/halo')
  },

  listSpaces: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.listSpaces()
    }
    return httpRequest('GET', '/api/spaces')
  },

  createSpace: async (input: {
    name: string
    icon: string
    customPath?: string
    workspaceKind?: 'regular' | 'knowledge_base'
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.createSpace(input)
    }
    return httpRequest('POST', '/api/spaces', input)
  },

  deleteSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.deleteSpace(spaceId)
    }
    return httpRequest('DELETE', `/api/spaces/${spaceId}`)
  },

  getSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getSpace(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}`)
  },

  openSpaceFolder: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.openSpaceFolder(spaceId)
    }
    // In remote mode, just return the path (can't open folder remotely)
    return httpRequest('POST', `/api/spaces/${spaceId}/open`)
  },

  getDefaultSpacePath: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getDefaultSpacePath()
    }
    // In remote mode, get default path from server
    return httpRequest('GET', '/api/spaces/default-path')
  },

  selectFolder: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.selectFolder()
    }
    // Cannot select folder in remote mode
    return { success: false, error: 'Cannot select folder in remote mode' }
  },

  updateSpace: async (
    spaceId: string,
    updates: { name?: string; icon?: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.updateSpace(spaceId, updates)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}`, updates)
  },

  // Update space preferences (layout settings)
  updateSpacePreferences: async (
    spaceId: string,
    preferences: {
      layout?: {
        artifactRailExpanded?: boolean
        chatWidth?: number
      }
    }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.updateSpacePreferences(spaceId, preferences)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}/preferences`, preferences)
  },

  // Get space preferences
  getSpacePreferences: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getSpacePreferences(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/preferences`)
  },

  // Check if a filesystem path exists (Electron only)
  checkPathExists: async (fsPath: string): Promise<ApiResponse<{ exists: boolean }>> => {
    if (isElectron()) return window.devx.checkPathExists(fsPath)
    return { success: false, error: 'Not available in browser' }
  },

  // ===== Conversation =====
  listConversations: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.listConversations(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations`)
  },

  createConversation: async (spaceId: string, title?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.createConversation(spaceId, title)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/conversations`, { title })
  },

  getConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getConversation(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations/${conversationId}`)
  },

  updateConversation: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.updateConversation(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}`,
      updates
    )
  },

  deleteConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.deleteConversation(spaceId, conversationId)
    }
    return httpRequest(
      'DELETE',
      `/api/spaces/${spaceId}/conversations/${conversationId}`
    )
  },

  addMessage: async (
    spaceId: string,
    conversationId: string,
    message: { role: string; content: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.addMessage(spaceId, conversationId, message)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages`,
      message
    )
  },

  updateLastMessage: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.updateLastMessage(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages/last`,
      updates
    )
  },

  getMessageThoughts: async (
    spaceId: string,
    conversationId: string,
    messageId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getMessageThoughts(spaceId, conversationId, messageId)
    }
    return httpRequest(
      'GET',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}/thoughts`
    )
  },

  toggleStarConversation: async (
    spaceId: string,
    conversationId: string,
    starred: boolean
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.toggleStarConversation(spaceId, conversationId, starred)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${spaceId}/conversations/${conversationId}/star`,
      { starred }
    )
  },

  // ===== Agent =====
  sendMessage: async (request: {
    spaceId: string
    conversationId: string
    message: string
    resumeSessionId?: string
    images?: Array<{
      id: string
      type: 'image'
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      data: string
      name?: string
      size?: number
    }>
    aiBrowserEnabled?: boolean  // Enable AI Browser tools
    thinkingEnabled?: boolean  // Enable extended thinking mode
    canvasContext?: {  // Canvas context for AI awareness
      isOpen: boolean
      tabCount: number
      activeTab: {
        type: string
        title: string
        url?: string
        path?: string
      } | null
      tabs: Array<{
        type: string
        title: string
        url?: string
        path?: string
        isActive: boolean
      }>
    }
  }): Promise<ApiResponse> => {
    // Subscribe to conversation events before sending
    if (!isElectron()) {
      subscribeToConversation(request.conversationId)
    }

    if (isElectron()) {
      return window.devx.sendMessage(request)
    }
    return httpRequest('POST', '/api/agent/message', request)
  },

  stopGeneration: async (conversationId?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.stopGeneration(conversationId)
    }
    return httpRequest('POST', '/api/agent/stop', { conversationId })
  },

  approveTool: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.approveTool(conversationId)
    }
    return httpRequest('POST', '/api/agent/approve', { conversationId })
  },

  rejectTool: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.rejectTool(conversationId)
    }
    return httpRequest('POST', '/api/agent/reject', { conversationId })
  },

  // Get current session state for recovery after refresh
  getSessionState: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getSessionState(conversationId)
    }
    return httpRequest('GET', `/api/agent/session/${conversationId}`)
  },

  // Warm up V2 session - call when switching conversations to prepare for faster message sending
  ensureSessionWarm: async (spaceId: string, conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      // No need to wait, initialize in background
      window.devx.ensureSessionWarm(spaceId, conversationId).catch((error: unknown) => {
        console.error('[API] ensureSessionWarm error:', error)
      })
      return { success: true }
    }
    // HTTP mode: send warm-up request to backend
    return httpRequest('POST', '/api/agent/warm', { spaceId, conversationId }).catch(() => ({
      success: false // Warm-up failure should not block
    }))
  },

  // Answer a pending AskUserQuestion
  answerQuestion: async (data: {
    conversationId: string
    id: string
    answers: Record<string, string>
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.answerQuestion(data)
    }
    return httpRequest('POST', '/api/agent/answer-question', data)
  },

  // Confirm or cancel a pending announce_file_changes dialog
  confirmFileChanges: async (data: { id: string; confirmed: boolean }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.confirmFileChanges(data)
    }
    return httpRequest('POST', '/api/agent/confirm-file-changes', data)
  },

  // Trigger background KB write after a pipeline session completes (fire-and-forget)
  triggerKbWrite: async (request: {
    kbSpaceId: string
    kbRootPath: string
    taskName: string
    taskContext: string
    projectDirs: string[]
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.triggerKbWrite(request)
    }
    return { success: false, error: 'KB write not supported in remote mode' }
  },

  // Test MCP server connections
  testMcpConnections: async (): Promise<{ success: boolean; servers: unknown[]; error?: string }> => {
    if (isElectron()) {
      return window.devx.testMcpConnections()
    }
    // HTTP mode: call backend endpoint
    const result = await httpRequest('POST', '/api/agent/test-mcp')
    return result as { success: boolean; servers: unknown[]; error?: string }
  },

  // ===== Artifact =====
  listArtifacts: async (spaceId: string, maxDepth: number = 2): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.listArtifacts(spaceId, maxDepth)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts?maxDepth=${maxDepth}`)
  },

  listArtifactsTree: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.listArtifactsTree(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts/tree`)
  },

  // Load children for lazy tree expansion
  loadArtifactChildren: async (spaceId: string, dirPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.loadArtifactChildren(spaceId, dirPath)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/children`, { dirPath })
  },

  // Initialize file watcher for a space
  initArtifactWatcher: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.initArtifactWatcher(spaceId)
    }
    // In remote mode, watcher is managed by server
    return { success: true }
  },

  // Subscribe to artifact change events
  onArtifactChanged: (callback: (data: {
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
    path: string
    relativePath: string
    spaceId: string
    item?: unknown
  }) => void) => {
    if (isElectron()) {
      return window.devx.onArtifactChanged(callback)
    }
    // In remote mode, use WebSocket events
    return onEvent('artifact:changed', callback)
  },

  // Subscribe to tree update events (pre-computed data, zero IPC round-trips)
  onArtifactTreeUpdate: (callback: (data: {
    spaceId: string
    updatedDirs: Array<{ dirPath: string; children: unknown[] }>
    changes: Array<{
      type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
      path: string
      relativePath: string
      spaceId: string
      item?: unknown
    }>
  }) => void) => {
    if (isElectron()) {
      return window.devx.onArtifactTreeUpdate(callback)
    }
    // In remote mode, use WebSocket events
    return onEvent('artifact:tree-update', callback)
  },

  openArtifact: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.openArtifact(filePath)
    }
    // Can't open files remotely
    return { success: false, error: 'Cannot open files in remote mode' }
  },

  showArtifactInFolder: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.showArtifactInFolder(filePath)
    }
    // Can't open folder remotely
    return { success: false, error: 'Cannot open folder in remote mode' }
  },

  // Download artifact (remote mode only - triggers browser download)
  downloadArtifact: (filePath: string): void => {
    if (isElectron()) {
      // In Electron, just open the file
      window.devx.openArtifact(filePath)
      return
    }
    // In remote mode, trigger download via browser with token in URL
    const token = getAuthToken()
    const url = `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
    const link = document.createElement('a')
    link.href = url
    link.download = filePath.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  },

  // Get download URL for an artifact (for use with fetch or direct links)
  getArtifactDownloadUrl: (filePath: string): string => {
    const token = getAuthToken()
    return `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
  },

  // Read artifact content for Content Canvas
  readArtifactContent: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.readArtifactContent(filePath)
    }
    // In remote mode, fetch content via API
    return httpRequest('GET', `/api/artifacts/content?path=${encodeURIComponent(filePath)}`)
  },

  // Save artifact content (CodeViewer edit mode)
  saveArtifactContent: async (filePath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.saveArtifactContent(filePath, content)
    }
    // In remote mode, save content via API
    return httpRequest('POST', '/api/artifacts/save', { path: filePath, content })
  },

  detectFileType: async (filePath: string): Promise<ApiResponse<{
    isText: boolean
    canViewInCanvas: boolean
    contentType: 'code' | 'markdown' | 'html' | 'image' | 'pdf' | 'text' | 'json' | 'csv' | 'binary'
    language?: string
    mimeType: string
  }>> => {
    if (isElectron()) {
      return window.devx.detectFileType(filePath)
    }
    // In remote mode, detect file type via API
    return httpRequest('GET', `/api/artifacts/detect-type?path=${encodeURIComponent(filePath)}`)
  },

  getGitBranchForPath: async (filePath: string): Promise<ApiResponse<{ branch: string | null }>> => {
    if (isElectron()) {
      return window.devx.getGitBranchForPath(filePath)
    }
    return httpRequest('GET', `/api/artifacts/git-branch?path=${encodeURIComponent(filePath)}`)
  },

  runArtifactGitCommand: async (
    spaceId: string,
    targetPath: string,
    action: 'status' | 'add' | 'pull' | 'pull-rebase' | 'push' | 'diff'
  ): Promise<ApiResponse<{ ok: boolean; stdout: string; stderr: string; error?: string }>> => {
    if (isElectron()) {
      return window.devx.runArtifactGitCommand(spaceId, targetPath, action)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/git`, { targetPath, action })
  },

  gitWorkspaceStatus: async (spaceId: string): Promise<ApiResponse<GitWorkspaceStatusData>> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceStatus(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/git/status`)
  },

  gitWorkspaceDiff: async (
    spaceId: string,
    relativePath: string,
    view: 'staged' | 'unstaged'
  ): Promise<ApiResponse<GitWorkspaceDiffData>> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceDiff(spaceId, relativePath, view)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/diff`, { path: relativePath, view })
  },

  gitWorkspaceStage: async (spaceId: string, paths: string[]): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceStage(spaceId, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/stage`, { paths })
  },

  gitWorkspaceStageAll: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceStageAll(spaceId)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/stage-all`, {})
  },

  gitWorkspaceUnstage: async (spaceId: string, paths: string[]): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceUnstage(spaceId, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/unstage`, { paths })
  },

  gitWorkspaceUnstageAll: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceUnstageAll(spaceId)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/unstage-all`, {})
  },

  gitWorkspaceCommit: async (
    spaceId: string,
    message: string,
    amend?: boolean
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceCommit(spaceId, message, amend)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/commit`, { message, amend: !!amend })
  },

  gitWorkspaceDiscardWorking: async (spaceId: string, paths: string[]): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceDiscardWorking(spaceId, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/discard-working`, { paths })
  },

  gitWorkspaceBranchList: async (spaceId: string): Promise<ApiResponse<GitBranchListData>> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceBranchList(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/git/branches`)
  },

  gitWorkspaceCheckoutBranch: async (spaceId: string, branch: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceCheckoutBranch(spaceId, branch)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/checkout-branch`, { branch })
  },

  gitWorkspaceDeleteBranch: async (
    spaceId: string,
    branch: string,
    force?: boolean
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceDeleteBranch(spaceId, branch, force)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/delete-branch`, { branch, force: !!force })
  },

  gitWorkspaceCreateBranch: async (spaceId: string, name: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitWorkspaceCreateBranch(spaceId, name)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/create-branch`, { name })
  },

  gitProjectDirStatus: async (
    spaceId: string,
    topLevelDir: string
  ): Promise<ApiResponse<GitWorkspaceStatusData>> => {
    if (isElectron()) {
      return window.devx.gitProjectDirStatus(spaceId, topLevelDir)
    }
    const q = new URLSearchParams({ dir: topLevelDir })
    return httpRequest('GET', `/api/spaces/${spaceId}/git/project-status?${q}`)
  },

  gitProjectDirDiff: async (
    spaceId: string,
    topLevelDir: string,
    relativePath: string,
    view: 'staged' | 'unstaged'
  ): Promise<ApiResponse<GitWorkspaceDiffData>> => {
    if (isElectron()) {
      return window.devx.gitProjectDirDiff(spaceId, topLevelDir, relativePath, view)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/diff`, {
      topLevel: topLevelDir,
      path: relativePath,
      view,
    })
  },

  gitProjectDirStage: async (
    spaceId: string,
    topLevelDir: string,
    paths: string[]
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirStage(spaceId, topLevelDir, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/stage`, {
      topLevel: topLevelDir,
      paths,
    })
  },

  gitProjectDirUnstage: async (
    spaceId: string,
    topLevelDir: string,
    paths: string[]
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirUnstage(spaceId, topLevelDir, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/unstage`, {
      topLevel: topLevelDir,
      paths,
    })
  },

  gitProjectDirCommit: async (
    spaceId: string,
    topLevelDir: string,
    message: string,
    amend?: boolean
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirCommit(spaceId, topLevelDir, message, amend)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/commit`, {
      topLevel: topLevelDir,
      message,
      amend: !!amend,
    })
  },

  gitProjectDirDiscardWorking: async (
    spaceId: string,
    topLevelDir: string,
    paths: string[]
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirDiscardWorking(spaceId, topLevelDir, paths)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/discard-working`, {
      topLevel: topLevelDir,
      paths,
    })
  },

  gitProjectDirBranchList: async (
    spaceId: string,
    topLevelDir: string
  ): Promise<ApiResponse<GitBranchListData>> => {
    if (isElectron()) {
      return window.devx.gitProjectDirBranchList(spaceId, topLevelDir)
    }
    const q = new URLSearchParams({ dir: topLevelDir })
    return httpRequest('GET', `/api/spaces/${spaceId}/git/project/branches?${q}`)
  },

  gitProjectDirCheckoutBranch: async (
    spaceId: string,
    topLevelDir: string,
    branch: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirCheckoutBranch(spaceId, topLevelDir, branch)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/checkout-branch`, {
      topLevel: topLevelDir,
      branch,
    })
  },

  gitProjectDirDeleteBranch: async (
    spaceId: string,
    topLevelDir: string,
    branch: string,
    force?: boolean
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirDeleteBranch(spaceId, topLevelDir, branch, force)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/delete-branch`, {
      topLevel: topLevelDir,
      branch,
      force: !!force,
    })
  },

  gitProjectDirCreateBranch: async (
    spaceId: string,
    topLevelDir: string,
    name: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.gitProjectDirCreateBranch(spaceId, topLevelDir, name)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/git/project/create-branch`, {
      topLevel: topLevelDir,
      name,
    })
  },

  // ===== File Operations =====
  // Create and move send (parentPath, name) — backend constructs full path via path.join.
  // Responses include { data: { path } } with the resolved absolute path.

  // Create file
  createArtifactFile: async (spaceId: string, parentPath: string, name: string, content: string = ''): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.createArtifactFile(spaceId, parentPath, name, content)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/file`, { parentPath, name, content })
  },

  // Create folder
  createArtifactFolder: async (spaceId: string, parentPath: string, name: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.createArtifactFolder(spaceId, parentPath, name)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/folder`, { parentPath, name })
  },

  // Delete file or folder
  deleteArtifact: async (spaceId: string, targetPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.deleteArtifact(spaceId, targetPath)
    }
    return httpRequest('DELETE', `/api/spaces/${spaceId}/artifacts`, { path: targetPath })
  },

  // Rename file or folder
  renameArtifact: async (spaceId: string, oldPath: string, newName: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.renameArtifact(spaceId, oldPath, newName)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/rename`, { oldPath, newName })
  },

  // Move file or folder — sends (oldPath, newParentPath), backend constructs destination
  moveArtifact: async (spaceId: string, oldPath: string, newParentPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.moveArtifact(spaceId, oldPath, newParentPath)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/artifacts/move`, { oldPath, newParentPath })
  },

  workspaceSearch: async (
    spaceId: string,
    query: string,
    options?: WorkspaceSearchOptionsInput
  ): Promise<ApiResponse<WorkspaceSearchMatch[]>> => {
    if (isElectron()) {
      return window.devx.workspaceSearch(spaceId, query, options)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/workspace-search`, { query, options })
  },

  workspaceReplaceAll: async (
    spaceId: string,
    find: string,
    replace: string,
    options?: WorkspaceSearchOptionsInput
  ): Promise<ApiResponse<WorkspaceReplaceAllResult>> => {
    if (isElectron()) {
      return window.devx.workspaceReplaceAll(spaceId, find, replace, options)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/workspace-replace-all`, { find, replace, options })
  },

  // ===== Onboarding =====
  writeOnboardingArtifact: async (
    spaceId: string,
    fileName: string,
    content: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.writeOnboardingArtifact(spaceId, fileName, content)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/artifact`, { fileName, content })
  },

  saveOnboardingConversation: async (
    spaceId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.saveOnboardingConversation(spaceId, userMessage, aiResponse)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/conversation`, { userMessage, aiResponse })
  },

  // ===== Remote Access (Electron only) =====
  enableRemoteAccess: async (port?: number): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.enableRemoteAccess(port)
  },

  disableRemoteAccess: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.disableRemoteAccess()
  },

  enableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.enableTunnel()
  },

  disableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.disableTunnel()
  },

  getRemoteStatus: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.getRemoteStatus()
  },

  getRemoteQRCode: async (includeToken?: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.getRemoteQRCode(includeToken)
  },

  setRemotePassword: async (password: string): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.setRemotePassword(password)
  },

  regenerateRemotePassword: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.regenerateRemotePassword()
  },

  // ===== System Settings (Electron only) =====
  getAutoLaunch: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.getAutoLaunch()
  },

  setAutoLaunch: async (enabled: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.setAutoLaunch(enabled)
  },

  openLogFolder: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.openLogFolder()
  },

  // ===== Window (Electron only) =====
  setTitleBarOverlay: async (options: {
    color: string
    symbolColor: string
  }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: true } // No-op in remote mode
    }
    return window.devx.setTitleBarOverlay(options)
  },

  maximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.maximizeWindow()
  },

  unmaximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.unmaximizeWindow()
  },

  isWindowMaximized: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.isWindowMaximized()
  },

  toggleMaximizeWindow: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.toggleMaximizeWindow()
  },

  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    if (!isElectron()) {
      return () => { } // No-op in remote mode
    }
    return window.devx.onWindowMaximizeChange(callback)
  },

  // ===== Notification Channels =====
  testNotificationChannel: async (channelType: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.testNotificationChannel(channelType)
    }
    return httpRequest('POST', '/api/notify-channels/test', { channelType })
  },

  clearNotificationChannelCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.clearNotificationChannelCache()
    }
    return httpRequest('POST', '/api/notify-channels/clear-cache')
  },

  // ===== WeCom Bot (企业微信智能机器人) =====
  getWecomBotStatus: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getWecomBotStatus()
    }
    return httpRequest('GET', '/api/wecom-bot/status')
  },

  reconnectWecomBot: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.reconnectWecomBot()
    }
    return httpRequest('POST', '/api/wecom-bot/reconnect')
  },

  // ===== IM Sessions (会话管理) =====
  imSessionsList: async (appId?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.imSessionsList(appId)
    }
    const path = appId ? `/api/im-sessions/${appId}` : '/api/im-sessions'
    return httpRequest('GET', path)
  },

  imSessionsSetProactive: async (input: { appId: string; channel: string; chatId: string; proactive: boolean }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.imSessionsSetProactive(input)
    }
    return httpRequest('POST', '/api/im-sessions/set-proactive', input)
  },

  imSessionsRemove: async (input: { appId: string; channel: string; chatId: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.imSessionsRemove(input)
    }
    return httpRequest('POST', '/api/im-sessions/remove', input)
  },

  imSessionsSetCustomName: async (input: { appId: string; channel: string; chatId: string; name: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.imSessionsSetCustomName(input)
    }
    return httpRequest('POST', '/api/im-sessions/set-custom-name', input)
  },

  // ===== Event Listeners =====
  onAgentMessage: (callback: (data: unknown) => void) =>
    onEvent('agent:message', callback),
  onAgentToolCall: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-call', callback),
  onAgentToolResult: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-result', callback),
  onAgentError: (callback: (data: unknown) => void) =>
    onEvent('agent:error', callback),
  onAgentComplete: (callback: (data: unknown) => void) =>
    onEvent('agent:complete', callback),
  onAgentThought: (callback: (data: unknown) => void) =>
    onEvent('agent:thought', callback),
  onAgentThoughtDelta: (callback: (data: unknown) => void) =>
    onEvent('agent:thought-delta', callback),
  onAgentMcpStatus: (callback: (data: unknown) => void) =>
    onEvent('agent:mcp-status', callback),
  onAgentCompact: (callback: (data: unknown) => void) =>
    onEvent('agent:compact', callback),
  onAgentAskQuestion: (callback: (data: unknown) => void) =>
    onEvent('agent:ask-question', callback),
  onAgentAnnounceFileChanges: (callback: (data: unknown) => void) =>
    onEvent('agent:announce-file-changes', callback),
  onAgentKbWriteComplete: (callback: (data: unknown) => void) =>
    onEvent('agent:kb-write-complete', callback),
  onAgentSessionInfo: (callback: (data: unknown) => void) =>
    onEvent('agent:session-info', callback),
  onRemoteStatusChange: (callback: (data: unknown) => void) =>
    onEvent('remote:status-change', callback),

  // ===== Server URL Management (Capacitor) =====
  setServerUrl,
  getServerUrl,
  restoreServerUrl,
  clearServerUrl,
  clearPendingServerUrl,

  // ===== WebSocket Control =====
  connectWebSocket,
  disconnectWebSocket,
  forceReconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,
  onWsStateChange,
  onEvent,

  // ===== Browser (Embedded Browser for Content Canvas) =====
  // Note: Browser features only available in desktop app (not remote mode)

  getBrowserHomepage: async (): Promise<string> => {
    if (isElectron()) {
      const result = await window.devx.getBrowserHomepage()
      if (result.success) return result.data as string
    }
    return 'https://www.bing.com'
  },

  createBrowserView: async (viewId: string, url?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.createBrowserView(viewId, url)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  destroyBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.destroyBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  showBrowserView: async (
    viewId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.showBrowserView(viewId, bounds)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  hideBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.hideBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  resizeBrowserView: async (
    viewId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.resizeBrowserView(viewId, bounds)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  navigateBrowserView: async (viewId: string, url: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.navigateBrowserView(viewId, url)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserGoBack: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.browserGoBack(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserGoForward: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.browserGoForward(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserReload: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.browserReload(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserStop: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.browserStop(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  getBrowserState: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.getBrowserState(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  captureBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.captureBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  executeBrowserJS: async (viewId: string, code: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.executeBrowserJS(viewId, code)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  setBrowserZoom: async (viewId: string, level: number): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.setBrowserZoom(viewId, level)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  toggleBrowserDevTools: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.toggleBrowserDevTools(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  setBrowserDeviceMode: async (viewId: string, mode: 'pc' | 'h5'): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.setBrowserDeviceMode(viewId, mode)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  showBrowserContextMenu: async (options: { viewId: string; url?: string; zoomLevel: number }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.showBrowserContextMenu(options)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  onBrowserStateChange: (callback: (data: unknown) => void) =>
    onEvent('browser:state-change', callback),

  onBrowserZoomChanged: (callback: (data: { viewId: string; zoomLevel: number }) => void) =>
    onEvent('browser:zoom-changed', callback as (data: unknown) => void),

  // Canvas Tab Context Menu (native Electron menu)
  showCanvasTabContextMenu: async (options: {
    tabId: string
    tabIndex: number
    tabTitle: string
    tabPath?: string
    tabCount: number
    hasTabsToRight: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.showCanvasTabContextMenu(options)
    }
    return { success: false, error: 'Native menu only available in desktop app' }
  },

  onCanvasTabAction: (callback: (data: {
    action: 'close' | 'closeOthers' | 'closeToRight' | 'copyPath' | 'refresh'
    tabId?: string
    tabIndex?: number
    tabPath?: string
  }) => void) =>
    onEvent('canvas:tab-action', callback as (data: unknown) => void),

  // AI Browser active view change notification
  // Sent when AI Browser tools create or select a view
  onAIBrowserActiveViewChanged: (callback: (data: { viewId: string; url: string | null; title: string | null }) => void) =>
    onEvent('ai-browser:active-view-changed', callback as (data: unknown) => void),

  // ===== Search =====
  search: async (
    query: string,
    scope: 'conversation' | 'space' | 'global',
    conversationId?: string,
    spaceId?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.search(query, scope, conversationId, spaceId)
    }
    return httpRequest('POST', '/api/search', {
      query,
      scope,
      conversationId,
      spaceId
    })
  },

  cancelSearch: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.cancelSearch()
    }
    return httpRequest('POST', '/api/search/cancel')
  },

  onSearchProgress: (callback: (data: { current: number; total: number; searchId: string }) => void) =>
    onEvent('search:progress', callback),

  onSearchCancelled: (callback: () => void) =>
    onEvent('search:cancelled', callback),

  // ===== Updater (Electron only) =====
  checkForUpdates: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.checkForUpdates()
  },

  installUpdate: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.installUpdate()
  },

  getVersion: async (): Promise<ApiResponse<string>> => {
    if (isElectron()) {
      const version = await window.devx.getVersion()
      return { success: true, data: version }
    }
    // Remote mode: get version from server
    return httpRequest('GET', '/api/system/version')
  },

  onUpdaterStatus: (callback: (data: {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
    version?: string
    percent?: number
    message?: string
    releaseNotes?: string | { version: string; note: string }[]
  }) => void) => {
    if (!isElectron()) {
      return () => { } // No-op in remote mode
    }
    return window.devx.onUpdaterStatus(callback)
  },

  // ===== Notification (in-app toast) =====
  onNotificationToast: (callback: (data: {
    title: string
    body?: string
    variant?: 'default' | 'success' | 'warning' | 'error'
    duration?: number
    appId?: string
  }) => void) => {
    if (!isElectron()) {
      return () => { } // No-op in remote mode
    }
    return window.devx.onNotificationToast(callback)
  },

  // ===== Overlay (Electron only) =====
  // Used for floating UI elements that need to render above BrowserViews
  showChatCapsuleOverlay: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.showChatCapsuleOverlay()
  },

  hideChatCapsuleOverlay: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.hideChatCapsuleOverlay()
  },

  onCanvasExitMaximized: (callback: () => void) => {
    if (!isElectron()) {
      return () => { } // No-op in remote mode
    }
    return window.devx.onCanvasExitMaximized(callback)
  },

  // ===== Performance Monitoring (Electron only, Developer Tools) =====
  perfStart: async (config?: { sampleInterval?: number; maxSamples?: number }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfStart(config)
  },

  perfStop: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfStop()
  },

  perfGetState: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfGetState()
  },

  perfGetHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfGetHistory()
  },

  perfClearHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfClearHistory()
  },

  perfSetConfig: async (config: { enabled?: boolean; sampleInterval?: number; warnOnThreshold?: boolean }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfSetConfig(config)
  },

  perfExport: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.perfExport()
  },

  onPerfSnapshot: (callback: (data: unknown) => void) =>
    onEvent('perf:snapshot', callback),

  onPerfWarning: (callback: (data: unknown) => void) =>
    onEvent('perf:warning', callback),

  // Report renderer metrics to main process (for combined monitoring)
  perfReportRendererMetrics: (metrics: {
    fps: number
    frameTime: number
    renderCount: number
    domNodes: number
    eventListeners: number
    jsHeapUsed: number
    jsHeapLimit: number
    longTasks: number
  }): void => {
    if (isElectron()) {
      window.devx.perfReportRendererMetrics(metrics)
    }
  },

  // ===== Git Bash (Windows only, Electron only) =====
  getGitBashStatus: async (): Promise<ApiResponse<{
    found: boolean
    path: string | null
    source: 'system' | 'app-local' | 'env-var' | null
  }>> => {
    if (!isElectron()) {
      // In remote mode, assume Git Bash is available (server handles it)
      return { success: true, data: { found: true, path: null, source: null } }
    }
    return window.devx.getGitBashStatus()
  },

  installGitBash: async (onProgress: (progress: {
    phase: 'downloading' | 'extracting' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  }) => void): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.installGitBash(onProgress)
  },

  openLoginWindow: async (url: string, title?: string): Promise<ApiResponse> => {
    if (!isElectron()) {
      // In remote mode, open in new tab
      window.open(url, '_blank')
      return { success: true }
    }
    return window.devx.openLoginWindow(url, title)
  },

  openExternal: async (url: string): Promise<void> => {
    if (!isElectron()) {
      // In remote mode, open in new tab
      window.open(url, '_blank')
      return
    }
    return window.devx.openExternal(url)
  },

  // ===== Bootstrap Lifecycle (Electron only) =====
  // Used to coordinate renderer initialization with main process service registration.
  // Implements Pull+Push pattern for reliable initialization:
  // - Pull: getBootstrapStatus() for immediate state query (handles HMR, error recovery)
  // - Push: onBootstrapExtendedReady() for event-based notification (normal startup)

  getBootstrapStatus: async (): Promise<{
    extendedReady: boolean
    extendedReadyAt: number
  }> => {
    if (!isElectron()) {
      // In remote mode, services are always ready (server handles it)
      return { extendedReady: true, extendedReadyAt: Date.now() }
    }
    const result = await window.devx.getBootstrapStatus()
    return result.data ?? { extendedReady: false, extendedReadyAt: 0 }
  },

  onBootstrapExtendedReady: (callback: (data: { timestamp: number; duration: number }) => void) => {
    if (!isElectron()) {
      // In remote mode, services are always ready (server handles it)
      // Call callback immediately
      setTimeout(() => callback({ timestamp: Date.now(), duration: 0 }), 0)
      return () => {}
    }
    return window.devx.onBootstrapExtendedReady(callback)
  },

  // ===== Health System (Electron only) =====
  getHealthStatus: async (): Promise<ApiResponse<HealthStatusResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.getHealthStatus()
  },

  getHealthState: async (): Promise<ApiResponse<HealthStateResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.getHealthState()
  },

  triggerHealthRecovery: async (strategyId: string, userConsented: boolean): Promise<ApiResponse<HealthRecoveryResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.triggerHealthRecovery(strategyId, userConsented)
  },

  generateHealthReport: async (): Promise<ApiResponse<HealthReportResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.generateHealthReport()
  },

  generateHealthReportText: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.generateHealthReportText()
  },

  exportHealthReport: async (filePath?: string): Promise<ApiResponse<HealthExportResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.exportHealthReport(filePath)
  },

  runHealthCheck: async (): Promise<ApiResponse<HealthCheckResponse>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.devx.runHealthCheck()
  },

  // ===== Apps =====
  appList: async (filter?: { spaceId?: string; status?: string; type?: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appList(filter)
    }
    const params = new URLSearchParams()
    if (filter?.spaceId) params.set('spaceId', filter.spaceId)
    if (filter?.status) params.set('status', filter.status)
    if (filter?.type) params.set('type', filter.type)
    const qs = params.toString()
    return httpRequest('GET', `/api/apps${qs ? '?' + qs : ''}`)
  },

  appGet: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appGet(appId)
    }
    return httpRequest('GET', `/api/apps/${appId}`)
  },

  appInstall: async (input: { spaceId: string | null; spec: unknown; userConfig?: Record<string, unknown> }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appInstall(input)
    }
    return httpRequest('POST', '/api/apps/install', input as Record<string, unknown>)
  },

  appUninstall: async (appId: string, options?: { purge?: boolean }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appUninstall({ appId, options })
    }
    const qs = options?.purge ? '?purge=true' : ''
    return httpRequest('DELETE', `/api/apps/${appId}${qs}`)
  },

  appReinstall: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appReinstall({ appId })
    }
    return httpRequest('POST', `/api/apps/${appId}/reinstall`)
  },

  appDelete: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appDelete({ appId })
    }
    return httpRequest('DELETE', `/api/apps/${appId}/permanent`)
  },

  appPause: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appPause(appId)
    }
    return httpRequest('POST', `/api/apps/${appId}/pause`)
  },

  appResume: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appResume(appId)
    }
    return httpRequest('POST', `/api/apps/${appId}/resume`)
  },

  appTrigger: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appTrigger(appId)
    }
    return httpRequest('POST', `/api/apps/${appId}/trigger`)
  },

  appGetState: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appGetState(appId)
    }
    return httpRequest('GET', `/api/apps/${appId}/state`)
  },

  appGetActivity: async (appId: string, options?: { limit?: number; offset?: number; type?: string; since?: number }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appGetActivity({ appId, options })
    }
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))
    if (options?.since) params.set('before', String(options.since))
    const qs = params.toString()
    return httpRequest('GET', `/api/apps/${appId}/activity${qs ? '?' + qs : ''}`)
  },

  appGetSession: async (appId: string, runId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appGetSession({ appId, runId })
    }
    return httpRequest('GET', `/api/apps/${appId}/runs/${runId}/session`)
  },

  appRespondEscalation: async (appId: string, escalationId: string, response: { choice?: string; text?: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appRespondEscalation({
        appId,
        escalationId,
        response: { ts: Date.now(), ...response },
      })
    }
    return httpRequest('POST', `/api/apps/${appId}/escalation/${escalationId}/respond`, response as Record<string, unknown>)
  },

  appUpdateConfig: async (appId: string, config: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appUpdateConfig({ appId, config })
    }
    return httpRequest('POST', `/api/apps/${appId}/config`, config)
  },

  appUpdateFrequency: async (appId: string, subscriptionId: string, frequency: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appUpdateFrequency({ appId, subscriptionId, frequency })
    }
    return httpRequest('POST', `/api/apps/${appId}/frequency`, { subscriptionId, frequency })
  },

  appUpdateOverrides: async (appId: string, overrides: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appUpdateOverrides({ appId, overrides })
    }
    // JSON serialization strips `undefined` values. Convert them to `null` so the server
    // can apply JSON Merge Patch semantics (null = delete key, e.g. reset model to global).
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(overrides)) {
      patch[key] = value === undefined ? null : value
    }
    return httpRequest('PATCH', `/api/apps/${appId}/overrides`, patch)
  },

  appUpdateSpec: async (appId: string, specPatch: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appUpdateSpec({ appId, specPatch })
    }
    return httpRequest('PATCH', `/api/apps/${appId}/spec`, specPatch)
  },

  appGrantPermission: async (appId: string, permission: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appGrantPermission({ appId, permission })
    }
    return httpRequest('POST', `/api/apps/${appId}/permissions/grant`, { permission })
  },

  appRevokePermission: async (appId: string, permission: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appRevokePermission({ appId, permission })
    }
    return httpRequest('POST', `/api/apps/${appId}/permissions/revoke`, { permission })
  },

  // App Import / Export
  appExportSpec: async (appId: string): Promise<ApiResponse<{ yaml: string; filename: string }>> => {
    if (isElectron()) {
      return window.devx.appExportSpec(appId)
    }
    return httpRequest('GET', `/api/apps/${appId}/export-spec`)
  },

  appImportSpec: async (input: { spaceId: string; yamlContent: string; userConfig?: Record<string, unknown> }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appImportSpec(input)
    }
    return httpRequest('POST', '/api/apps/import-spec', input as Record<string, unknown>)
  },

  appOpenSkillFolder: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appOpenSkillFolder(appId)
    }
    // No filesystem access in web mode
    return { success: false, error: 'Not supported outside Electron' }
  },

  appGetDataPath: async (appId: string): Promise<ApiResponse<{ path: string }>> => {
    if (isElectron()) {
      return window.devx.appGetDataPath(appId)
    }
    // No filesystem access in web mode
    return { success: false, error: 'Not supported outside Electron' }
  },

  appOpenDataFolder: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appOpenDataFolder(appId)
    }
    // No filesystem access in web mode
    return { success: false, error: 'Not supported outside Electron' }
  },

  appClearMemory: async (appId: string): Promise<ApiResponse<{ filesRemoved: number }>> => {
    if (isElectron()) {
      return window.devx.appClearMemory(appId)
    }
    return httpRequest('POST', `/api/apps/${appId}/clear-memory`)
  },

  appMoveSpace: async (appId: string, newSpaceId: string | null): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appMoveSpace({ appId, newSpaceId })
    }
    return httpRequest('POST', `/api/apps/${appId}/move-space`, { newSpaceId })
  },

  // App Chat
  appChatSend: async (request: { appId: string; spaceId: string; message: string; images?: Array<{ type: string; media_type: string; data: string }>; thinkingEnabled?: boolean }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatSend(request)
    }
    return httpRequest('POST', `/api/apps/${request.appId}/chat/send`, request as unknown as Record<string, unknown>)
  },

  appChatStop: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatStop(appId)
    }
    return httpRequest('POST', `/api/apps/${appId}/chat/stop`)
  },

  appChatStatus: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatStatus(appId)
    }
    return httpRequest('GET', `/api/apps/${appId}/chat/status`)
  },

  appChatMessages: async (appId: string, spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatMessages({ appId, spaceId })
    }
    return httpRequest('GET', `/api/apps/${appId}/chat/messages?spaceId=${spaceId}`)
  },

  appChatSessionState: async (appId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatSessionState(appId)
    }
    return httpRequest('GET', `/api/apps/${appId}/chat/session-state`)
  },

  appChatClear: async (appId: string, spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.appChatClear({ appId, spaceId })
    }
    return httpRequest('POST', `/api/apps/${appId}/chat/clear`, { spaceId })
  },

  // App Event Listeners
  onAppStatusChanged: (callback: (data: unknown) => void) =>
    onEvent('app:status_changed', callback),

  onAppActivityEntry: (callback: (data: unknown) => void) =>
    onEvent('app:activity_entry:new', callback),

  onAppEscalation: (callback: (data: unknown) => void) =>
    onEvent('app:escalation:new', callback),

  onAppNavigate: (callback: (data: unknown) => void) =>
    onEvent('app:navigate', callback),

  // ===== Store (App Registry) =====
  storeQuery: async (params: { search?: string; type?: string; category?: string; page?: number; pageSize?: number; locale?: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeQuery(params)
    }
    return httpRequest('POST', '/api/store/query', params)
  },

  storeListApps: async (query: { search?: string; locale?: string; category?: string; type?: string; tags?: string[] }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeListApps(query)
    }
    const params = new URLSearchParams()
    if (query.search) params.set('search', query.search)
    if (query.locale) params.set('locale', query.locale)
    if (query.category) params.set('category', query.category)
    if (query.type) params.set('type', query.type)
    if (query.tags && query.tags.length > 0) {
      params.set('tags', query.tags.join(','))
    }
    const qs = params.toString()
    return httpRequest('GET', `/api/store/apps${qs ? '?' + qs : ''}`)
  },

  storeGetAppDetail: async (slug: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeGetAppDetail(slug)
    }
    return httpRequest('GET', `/api/store/apps/${slug}`)
  },

  storeInstall: async (
    slug: string,
    spaceId: string | null,
    userConfig?: Record<string, unknown>,
    onProgress?: Parameters<typeof window.devx.storeInstall>[1],
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeInstall({ slug, spaceId, userConfig }, onProgress)
    }
    return httpRequest('POST', `/api/store/apps/${slug}/install`, { spaceId, userConfig })
  },

  storeRefresh: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeRefresh()
    }
    return httpRequest('POST', '/api/store/refresh')
  },

  storeCheckUpdates: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeCheckUpdates()
    }
    return httpRequest('GET', '/api/store/updates')
  },

  storeGetRegistries: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeGetRegistries()
    }
    return httpRequest('GET', '/api/store/registries')
  },

  storeAddRegistry: async (input: { name: string; url: string; sourceType?: string; adapterConfig?: Record<string, unknown> }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeAddRegistry(input)
    }
    return httpRequest('POST', '/api/store/registries', input)
  },

  storeRemoveRegistry: async (registryId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeRemoveRegistry(registryId)
    }
    return httpRequest('DELETE', `/api/store/registries/${registryId}`)
  },

  storeToggleRegistry: async (registryId: string, enabled: boolean): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeToggleRegistry({ registryId, enabled })
    }
    return httpRequest('POST', `/api/store/registries/${registryId}/toggle`, { enabled })
  },

  storeUpdateRegistryAdapterConfig: async (registryId: string, adapterConfig: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.devx.storeUpdateRegistryAdapterConfig({ registryId, adapterConfig })
    }
    return httpRequest('PATCH', `/api/store/registries/${registryId}/adapter-config`, adapterConfig)
  },

  onStoreSyncStatusChanged: (callback: (data: { registryId: string; status: string; appCount: number; error?: string }) => void) => {
    if (isElectron()) {
      return window.devx.onStoreSyncStatusChanged(callback)
    }
    return onEvent('store:sync-status-changed', callback)
  },

  // ===== Pipeline (Tasks & Requirements) =====
  pipelineListTasks: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineListTasks(spaceId)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineGetTask: async (taskId: string): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineGetTask(taskId)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineCreateTask: async (input: { spaceId: string; title: string; requirement: string }): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineCreateTask(input)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineUpdateTask: async (input: { taskId: string; updates: Record<string, unknown> }): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineUpdateTask(input)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineDeleteTask: async (taskId: string): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineDeleteTask(taskId)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineUpsertSubtasks: async (input: { taskId: string; subtasks: Array<{ title: string; description: string }> }): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineUpsertSubtasks(input)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },

  pipelineUpdateSubtaskStatus: async (input: { subtaskId: string; status: string }): Promise<ApiResponse> => {
    if (isElectron()) return window.devx.pipelineUpdateSubtaskStatus(input)
    return { success: false, error: 'Pipeline only available in desktop app' }
  },
}

// Export type for the API
export type DevXApi = typeof api
