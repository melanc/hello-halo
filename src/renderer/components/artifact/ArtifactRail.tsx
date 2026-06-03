/**
 * 工作区导航栏（WorkspaceNavBar）— 组件导出名 ArtifactRail
 *
 * 仿 macOS Dock 风格的右侧导航栏。
 * 始终显示 48px 图标条（Dock），点击图标切换显示对应面板。
 * 文件导航栏、需求开发、Git、浏览器、工作区搜索各占一个图标。
 * 同一图标再次点击收起面板。
 *
 * Desktop (>=640px): Dock strip with inline panel
 * Mobile (<640px): Floating button + Overlay panel
 *
 * File list uses tree view only.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArtifactTree } from './ArtifactTree'
import { api } from '../../api'
import type { Artifact, ArtifactChangeEvent } from '../../types'
import { useIsGenerating } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useCanvasLifecycle } from '../../hooks/useCanvasLifecycle'
import { useCanvasStore } from '../../stores/canvas.store'
import { useTaskStore } from '../../stores/task.store'
import { ExternalLink, FolderOpen, Monitor, X, Globe, GitBranch, Search, ClipboardList, Terminal } from 'lucide-react'
import { GitSourceControlPanel } from '../git/GitSourceControlPanel'
import { RailWorkspaceFindPanel } from './RailWorkspaceFindPanel'
import { ONBOARDING_ARTIFACT_NAME } from '../onboarding/onboardingData'
import { useTranslation } from '../../i18n'
import { useIsMobile } from '../../hooks/useIsMobile'
import { getBrowserHomepage } from '../../utils/browser-homepage'

// Check if running in web mode
const isWebMode = api.isRemoteMode()

// Storage keys
const RAIL_MAIN_TAB_KEY = 'devx:rail-main-tab'

type RailMainTab = 'files' | 'source-control' | 'workspace-find'

function getInitialRailMainTab(): RailMainTab {
  if (typeof window === 'undefined') return 'files'
  const s =
    localStorage.getItem(RAIL_MAIN_TAB_KEY) ?? localStorage.getItem('halo:rail-main-tab')
  if (s === 'source-control') return 'source-control'
  if (s === 'workspace-find') return 'workspace-find'
  return 'files'
}

// Width constraints (in pixels) - Desktop only
const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 300
const COLLAPSED_WIDTH = 48
const clampWidth = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v))

interface ArtifactRailProps {
  // Width persistence
  initialWidth?: number             // Persisted width from config
  onWidthChange?: (width: number) => void  // Callback when user finishes resizing
}

function normalizeArtifactFromEvent(item: unknown, fallbackSpaceId: string): Artifact | null {
  if (!item || typeof item !== 'object') return null
  const candidate = item as Partial<Artifact> & {
    path?: string
    name?: string
    type?: string
    icon?: string
    extension?: string
    size?: number
    createdAt?: string
    spaceId?: string
    id?: string
  }

  if (!candidate.path || !candidate.name) {
    return null
  }

  return {
    id: candidate.id || `artifact-${Date.now()}`,
    spaceId: candidate.spaceId || fallbackSpaceId,
    conversationId: 'all',
    name: candidate.name,
    type: candidate.type === 'folder' ? 'folder' : 'file',
    path: candidate.path,
    extension: candidate.extension || '',
    icon: candidate.icon || 'file-text',
    createdAt: candidate.createdAt || new Date().toISOString(),
    relativePath: candidate.relativePath || candidate.name,
    preview: undefined,
    size: typeof candidate.size === 'number' ? candidate.size : undefined
  }
}

export function ArtifactRail({
  initialWidth,
  onWidthChange
}: ArtifactRailProps) {
  const { t } = useTranslation()

  // Self-subscribe to space data
  const currentSpace = useSpaceStore(state => state.currentSpace)
  const spaceId = currentSpace?.id ?? ''

  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const workspaceTasks = useTaskStore((s) => s.tasks)
  const activeTaskForSpace = useMemo(() => {
    if (!spaceId || !activeTaskId) return null
    return workspaceTasks.find((t) => t.id === activeTaskId && t.spaceId === spaceId) ?? null
  }, [spaceId, activeTaskId, workspaceTasks])

  /** Task-scoped file tree: always a Set when this space's active task is open (may be empty).
   *  Simple tasks show all files without dimming — no task-scoped file tree. */
  const taskProjectRootSetForSpace = useMemo(() => {
    if (!activeTaskForSpace) return null
    if (activeTaskForSpace.taskType === 'simple') return null
    return new Set([...activeTaskForSpace.projectDirs, ...(activeTaskForSpace.touchedProjectDirs ?? [])])
  }, [activeTaskForSpace])

  /** For simple tasks, use the project directory as the file tree's workspace root. */
  const treeSpaceId = useMemo(() => {
    if (activeTaskForSpace?.taskType === 'simple' && activeTaskForSpace.projectDirs[0]) {
      return activeTaskForSpace.projectDirs[0]
    }
    return spaceId
  }, [activeTaskForSpace, spaceId])

  const taskProjectDirNamesForGit = useMemo(() => {
    if (!taskProjectRootSetForSpace || taskProjectRootSetForSpace.size === 0) return undefined
    return Array.from(taskProjectRootSetForSpace).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    )
  }, [taskProjectRootSetForSpace])

  // ── All useState / useRef declarations first (avoids bundler TDZ issues) ──
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

  // Dock panel state: which panel is open, or null (only dock visible)
  const [activePanel, setActivePanel] = useState<RailMainTab | null>(() => getInitialRailMainTab())

  const [width, setWidth] = useState(initialWidth != null ? clampWidth(initialWidth) : DEFAULT_WIDTH)
  const widthRef = useRef(width)
  const [isDragging, setIsDragging] = useState(false)
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  /** Tracks last task session for this rail; `undefined` = not yet seeded (incl. after space change). */
  const prevRailTaskSessionRef = useRef<string | null | undefined>(undefined)
  const onWidthChangeRef = useRef(onWidthChange)
  onWidthChangeRef.current = onWidthChange
  const isGenerating = useIsGenerating()
  const { isActive: isOnboarding, currentStep, completeOnboarding } = useOnboardingStore()
  const isMobile = useIsMobile()

  // ── Callbacks ──

  const folderTargetSpaceId = spaceId

  const handleOpenFolder = useCallback(() => {
    if (folderTargetSpaceId) {
      useSpaceStore.getState().openSpaceFolder(folderTargetSpaceId)
    }
  }, [folderTargetSpaceId])

  // ── Effects ──

  // Sync width when initialWidth arrives from async config load
  useEffect(() => {
    if (initialWidth !== undefined && !isDragging) {
      const clamped = clampWidth(initialWidth)
      setWidth(clamped)
      widthRef.current = clamped
    }
  }, [initialWidth, isDragging])

  // Canvas lifecycle for opening browser
  const { openUrl } = useCanvasLifecycle()

  // When Canvas is open, disable transition to prevent layout flicker during resize/close
  const isCanvasOpen = useCanvasStore(state => state.isOpen)
  const canvasTabs = useCanvasStore(state => state.tabs)
  const activeCanvasTabId = useCanvasStore(state => state.activeTabId)
  const openRequirementDevTab = useCanvasStore(state => state.openRequirementDevTab)
  const openTerminalTab = useCanvasStore(state => state.openTerminalTab)
  const closeCanvasTab = useCanvasStore(state => state.closeTab)
  const requirementDevTab = canvasTabs.find((tab) => tab.type === 'requirement-dev')
  const isRequirementDevTabActive =
    requirementDevTab != null && activeCanvasTabId === requirementDevTab.id
  const terminalTab = canvasTabs.find((tab) => tab.type === 'terminal')
  const isTerminalTabActive =
    terminalTab != null && activeCanvasTabId === terminalTab.id
  const browserTab = canvasTabs.find((tab) => tab.type === 'browser')
  const isBrowserTabActive =
    browserTab != null && activeCanvasTabId === browserTab.id

  const setActivePanelPersist = useCallback((tab: RailMainTab | null) => {
    setActivePanel(tab)
    try {
      if (tab) {
        localStorage.setItem(RAIL_MAIN_TAB_KEY, tab)
      } else {
        localStorage.removeItem(RAIL_MAIN_TAB_KEY)
      }
    } catch {
      /* ignore quota */
    }
  }, [])

  // Handle dock item click (toggle on/off)
  const handleDockItemClick = useCallback((item: RailMainTab) => {
    // Close any active canvas tab first
    if (isTerminalTabActive && terminalTab) {
      closeCanvasTab(terminalTab.id)
    }
    if (isRequirementDevTabActive && requirementDevTab) {
      closeCanvasTab(requirementDevTab.id)
    }
    if (isBrowserTabActive && browserTab) {
      closeCanvasTab(browserTab.id)
    }
    setActivePanelPersist(activePanel === item ? null : item)
  }, [activePanel, setActivePanelPersist, isTerminalTabActive, terminalTab, isRequirementDevTabActive, requirementDevTab, isBrowserTabActive, browserTab, closeCanvasTab])

  const handleRequirementDevClick = useCallback(() => {
    if (!activeTaskForSpace) return
    if (isRequirementDevTabActive && requirementDevTab) {
      closeCanvasTab(requirementDevTab.id)
      return
    }
    // Close panel if open
    if (activePanel) {
      setActivePanelPersist(null)
    }
    void openRequirementDevTab(t('需求开发'))
  }, [
    activeTaskForSpace,
    isRequirementDevTabActive,
    requirementDevTab,
    closeCanvasTab,
    openRequirementDevTab,
    t,
    activePanel,
    setActivePanelPersist,
  ])

  const handleTerminalClick = useCallback(() => {
    if (isTerminalTabActive && terminalTab) {
      closeCanvasTab(terminalTab.id)
      return
    }
    // Close panel if open
    if (activePanel) {
      setActivePanelPersist(null)
    }
    void openTerminalTab(t('Terminal'))
  }, [isTerminalTabActive, terminalTab, closeCanvasTab, openTerminalTab, t, activePanel, setActivePanelPersist])

  // Check if we're in onboarding view-artifact step
  const isOnboardingViewStep = isOnboarding && currentStep === 'view-artifact'

  // Handle artifact click during onboarding
  // Delay completion so user can see the file open first
  const handleOnboardingArtifactClick = useCallback(() => {
    if (isOnboardingViewStep) {
      setTimeout(() => {
        completeOnboarding()
      }, 500)
    }
  }, [isOnboardingViewStep, completeOnboarding])

  useEffect(() => {
    prevRailTaskSessionRef.current = undefined
  }, [spaceId])

  // After entering or switching the active task for this space, default rail to workspace files
  useEffect(() => {
    const sid = activeTaskForSpace?.id ?? null
    const prev = prevRailTaskSessionRef.current
    if (prev === undefined) {
      prevRailTaskSessionRef.current = sid
      return
    }
    if (sid != null && sid !== prev) {
      setActivePanelPersist('files')
    }
    prevRailTaskSessionRef.current = sid
  }, [activeTaskForSpace?.id, setActivePanelPersist])

  // Handle drag resize (desktop only)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    setIsDragging(true)
  }, [isMobile])

  useEffect(() => {
    if (!isDragging || isMobile) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!railRef.current) return
      const newWidth = window.innerWidth - e.clientX
      const clampedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth))
      setWidth(clampedWidth)
      widthRef.current = clampedWidth
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      onWidthChangeRef.current?.(widthRef.current)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isMobile])

  // Close mobile overlay when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileOverlayOpen) {
      setMobileOverlayOpen(false)
    }
  }, [isMobile, mobileOverlayOpen])

  // Load artifacts from the main process
  const loadArtifacts = useCallback(async () => {
    if (!spaceId) return

    try {
      const response = await api.listArtifacts(spaceId)
      if (response.success && response.data) {
        setArtifacts(response.data as Artifact[])
      }
    } catch (error) {
      console.error('[ArtifactRail] Failed to load artifacts:', error)
    }
  }, [spaceId])

  // Load artifacts on mount and when space changes
  useEffect(() => {
    loadArtifacts()
  }, [loadArtifacts])

  // Refresh artifacts when generation completes (debounced)
  useEffect(() => {
    if (!isGenerating) {
      const timer = setTimeout(loadArtifacts, 500)
      return () => clearTimeout(timer)
    }
  }, [isGenerating, loadArtifacts])

  // Subscribe to artifact change events for incremental updates
  useEffect(() => {
    if (!spaceId) return

    // Initialize watcher for this space
    api.initArtifactWatcher(spaceId).catch(err => {
      console.error('[ArtifactRail] Failed to init watcher:', err)
    })

    // Subscribe to change events
    const cleanup = api.onArtifactChanged((event: ArtifactChangeEvent) => {
      if (event.spaceId !== spaceId) return

      console.log('[ArtifactRail] Artifact changed:', event.type, event.relativePath)

      const normalizedArtifact = event.item
        ? normalizeArtifactFromEvent(event.item, spaceId)
        : null

      switch (event.type) {
        case 'add':
        case 'addDir':
          if (normalizedArtifact) {
            setArtifacts(prev => {
              if (prev.some(a => a.path === normalizedArtifact.path)) return prev
              return [normalizedArtifact, ...prev]
            })
          } else {
            loadArtifacts()
          }
          break

        case 'unlink':
        case 'unlinkDir':
          setArtifacts(prev => prev.filter(a => a.path !== event.path))
          break

        case 'change':
          if (normalizedArtifact) {
            setArtifacts(prev =>
              prev.map(a => (a.path === normalizedArtifact.path ? normalizedArtifact : a))
            )
          } else {
            loadArtifacts()
          }
          break
      }
    })

    return cleanup
  }, [spaceId, loadArtifacts])

  // Refresh artifacts when entering view-artifact onboarding step
  useEffect(() => {
    if (isOnboardingViewStep) {
      // Delay slightly to ensure file is written
      const timer = setTimeout(loadArtifacts, 300)
      return () => clearTimeout(timer)
    }
  }, [isOnboardingViewStep, loadArtifacts])

  // Handle opening browser
  const handleOpenBrowser = useCallback(() => {
    // Close panel if open
    if (activePanel) {
      setActivePanelPersist(null)
    }
    getBrowserHomepage().then(url => openUrl(url, t('Browser')))
  }, [openUrl, t, activePanel, setActivePanelPersist])

  // Shared content renderer
  const renderContent = () => (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {activePanel === 'source-control' ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <GitSourceControlPanel spaceId={spaceId} taskProjectDirNames={taskProjectDirNamesForGit} />
        </div>
      ) : activePanel === 'workspace-find' ? (
        <RailWorkspaceFindPanel spaceId={spaceId} isWebMode={isWebMode} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <ArtifactTree
              key={`rail-workspace-${treeSpaceId}-${activeTaskForSpace?.id ?? 'none'}`}
              spaceId={treeSpaceId}
              taskProjectRootSet={taskProjectRootSetForSpace}
              taskFocusSessionId={activeTaskForSpace?.id ?? null}
              taskNoExplicitProjectDirs={
                activeTaskForSpace != null && activeTaskForSpace.projectDirs.length === 0
              }
              onboardingHighlightFileName={isOnboardingViewStep ? ONBOARDING_ARTIFACT_NAME : undefined}
              onboardingArtifactActivate={isOnboardingViewStep ? handleOnboardingArtifactClick : undefined}
            />
          </div>
        </div>
      )}
    </div>
  )

  // Shared footer renderer with folder and browser buttons
  // flex-shrink-0 ensures footer doesn't compress, allowing content to take remaining space
  const renderFooter = () => (
    <div className="flex-shrink-0 p-2 border-t border-border">
      {isWebMode ? (
        <div className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground/50 rounded-lg cursor-not-allowed">
          <Monitor className="w-4 h-4" />
          <span>{t('Please open folder in client')}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Open folder button */}
          <button
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg transition-colors"
            title={t('Open folder (⌘⇧F)')}
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>{t('Open folder')}</span>
          </button>
        </div>
      )}
    </div>
  )

  // ==================== Mobile Overlay Mode ====================
  if (isMobile) {
    return (
      <>
        {/* Floating trigger button - z-[60] to stay above Canvas overlay (z-50) */}
        <button
          onClick={() => setMobileOverlayOpen(true)}
          className="
            fixed right-0 top-1/3 z-[60]
            w-10 h-14
            bg-card
            border-l border-y border-border
            rounded-l-xl
            shadow-lg
            flex flex-col items-center justify-center gap-1
            hover:bg-card
            active:scale-95
            transition-all duration-200
          "
          aria-label={t('Open artifacts panel')}
        >
          <FolderOpen className="w-4 h-4 text-amber-500" />
          {artifacts.length > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {artifacts.length}
            </span>
          )}
        </button>

        {/* Overlay backdrop + panel - z-[70] to stay above Canvas overlay (z-50) */}
        {mobileOverlayOpen && (
          <div className="fixed inset-0 z-[70] flex justify-end">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-background/70 animate-fade-in"
              onClick={() => setMobileOverlayOpen(false)}
            />

            {/* Slide-in panel */}
            <div
              className="
                relative w-[min(280px,75vw)] h-full
                bg-card border-l border-border
                flex flex-col
                animate-slide-in-right-full
                shadow-2xl
              "
            >
              {/* Header */}
              <div className="p-2.5 border-b border-border flex items-center justify-between gap-2 min-h-[44px]">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActivePanelPersist(activePanel === 'files' ? null : 'files')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${activePanel === 'files' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('File navigation bar')}
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanelPersist(activePanel === 'workspace-find' ? null : 'workspace-find')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${activePanel === 'workspace-find' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Search in files')}
                  >
                    <Search className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleTerminalClick}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${isTerminalTabActive ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Terminal')}
                  >
                    <Terminal className="w-5 h-5 text-green-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanelPersist(activePanel === 'source-control' ? null : 'source-control')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${activePanel === 'source-control' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Git operations')}
                  >
                    <GitBranch className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRequirementDevClick}
                    disabled={!activeTaskForSpace}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${isRequirementDevTabActive ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                      ${!activeTaskForSpace ? 'opacity-40 cursor-not-allowed' : ''}
                    `}
                    title={t('需求开发')}
                  >
                    <ClipboardList className="w-5 h-5 text-violet-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOpenBrowser()}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${isBrowserTabActive ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Open browser (⌘⇧B)')}
                  >
                    <Globe className="w-5 h-5 text-blue-500" />
                  </button>
                  {activePanel === 'source-control' && !isWebMode && (
                    <button
                      type="button"
                      onClick={() => void api.gitOpenWindow({ spaceId })}
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-secondary/80 text-muted-foreground/50 hover:text-muted-foreground"
                      title={t('Open in window')}
                    >
                      <ExternalLink className="w-5 h-5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setMobileOverlayOpen(false)}
                  className="h-10 w-10 shrink-0 flex items-center justify-center hover:bg-secondary rounded-lg transition-colors"
                  aria-label={t('Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              {renderContent()}

              {/* Footer */}
              {renderFooter()}
            </div>
          </div>
        )}
      </>
    )
  }

  // ==================== Desktop Inline Mode ====================
  const panelIsOpen = activePanel !== null
  // Total width = panel width (when open) + dock strip width
  const totalWidth = panelIsOpen ? width + COLLAPSED_WIDTH : COLLAPSED_WIDTH

  return (
    <div
      ref={railRef}
      className="h-full flex-shrink-0 flex"
      style={{
        width: totalWidth,
        // Disable transition when: dragging OR Canvas is open (prevent layout flicker)
        transition: (isDragging || isCanvasOpen) ? 'none' : 'width 0.2s ease'
      }}
    >
      {/* Panel content (when a dock item is active) */}
      {panelIsOpen && (
        <div className="h-full border-l border-border bg-card/30 flex flex-col relative overflow-hidden"
          style={{ width, minWidth: MIN_WIDTH }}
        >
          {/* Drag handle */}
          <div
            className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-20 ${
              isDragging ? 'bg-primary/50' : ''
            }`}
            onMouseDown={handleMouseDown}
            title={t('Drag to resize')}
          />

          {/* Panel header — title centered */}
          <div className="flex-shrink-0 px-3 min-h-11 h-11 border-b border-border flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground select-none text-center">
              {activePanel === 'files' ? t('File navigation bar') :
               activePanel === 'workspace-find' ? t('Search in files') :
               t('Git operations')}
            </span>
            {activePanel === 'source-control' && !isWebMode && (
              <button
                type="button"
                onClick={() => void api.gitOpenWindow({ spaceId })}
                className="absolute right-2 h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-secondary/80 text-muted-foreground/50 hover:text-muted-foreground"
                title={t('Open in window')}
              >
                <ExternalLink className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
              </button>
            )}
          </div>

          {/* Content + Footer */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {renderContent()}
            {renderFooter()}
          </div>
        </div>
      )}

      {/* Dock strip (always visible) — icons centered in the bar */}
      <div
        className="h-full flex-shrink-0 border-l border-border bg-card/30 flex flex-col items-center gap-2 pt-10"
        style={{ width: COLLAPSED_WIDTH }}
      >
        {/* Files icon — 文件 */}
        <button
          type="button"
          onClick={() => handleDockItemClick('files')}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            activePanel === 'files'
              ? 'bg-secondary text-primary ring-1 ring-border'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('File navigation bar')}
        >
          <FolderOpen className="w-5 h-5 text-amber-500" />
        </button>

        {/* Search icon — 搜索 */}
        <button
          type="button"
          onClick={() => handleDockItemClick('workspace-find')}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            activePanel === 'workspace-find'
              ? 'bg-secondary text-primary ring-1 ring-border'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('Search in files')}
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Terminal icon — 终端 */}
        <button
          type="button"
          onClick={handleTerminalClick}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            isTerminalTabActive
              ? 'bg-secondary text-primary ring-1 ring-border'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('Terminal')}
        >
          <Terminal className="w-5 h-5 text-green-500" />
        </button>

        {/* Git icon — Git */}
        <button
          type="button"
          onClick={() => handleDockItemClick('source-control')}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            activePanel === 'source-control'
              ? 'bg-secondary text-primary ring-1 ring-border'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('Git operations')}
        >
          <GitBranch className="w-5 h-5" />
        </button>

        {/* 需求开发 — 需求 */}
        <button
          type="button"
          onClick={handleRequirementDevClick}
          disabled={!activeTaskForSpace}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            isRequirementDevTabActive
              ? 'bg-secondary text-primary ring-1 ring-border'
              : activeTaskForSpace
                ? 'hover:bg-secondary text-muted-foreground'
                : 'opacity-40 cursor-not-allowed text-muted-foreground'
          }`}
          title={t('需求开发')}
        >
          <ClipboardList className="w-5 h-5 text-violet-500" />
        </button>

        {/* Browser icon — 浏览器 */}
        <button
          type="button"
          onClick={handleOpenBrowser}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            isBrowserTabActive
              ? 'bg-secondary text-primary ring-1 ring-border'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('Open browser (⌘⇧B)')}
        >
          <Globe className="w-5 h-5 text-blue-500" />
        </button>
      </div>
    </div>
  )
}
