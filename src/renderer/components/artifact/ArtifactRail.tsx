/**
 * Artifact Rail - Side panel showing created files
 *
 * Desktop (>=640px): Inline panel with drag-to-resize
 * Mobile (<640px): Floating button + Overlay panel
 *
 * File list uses tree view only.
 * Supports external control for Canvas integration (smart collapse)
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
import { BookOpen, ChevronRight, FolderOpen, Monitor, X, Globe, GitBranch, Search } from 'lucide-react'
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

type RailMainTab = 'files' | 'source-control' | 'workspace-find' | 'knowledge-base'

function getInitialRailMainTab(): RailMainTab {
  if (typeof window === 'undefined') return 'files'
  const s =
    localStorage.getItem(RAIL_MAIN_TAB_KEY) ?? localStorage.getItem('halo:rail-main-tab')
  if (s === 'source-control') return 'source-control'
  if (s === 'workspace-find') return 'workspace-find'
  // knowledge-base is session-only (depends on active task), never restore from storage
  return 'files'
}

// Width constraints (in pixels) - Desktop only
const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 300
const COLLAPSED_WIDTH = 48
const clampWidth = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v))

interface ArtifactRailProps {
  // External control props for Canvas integration
  externalExpanded?: boolean        // Controlled expanded state from parent
  onExpandedChange?: (expanded: boolean) => void  // Callback when user toggles
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
  externalExpanded,
  onExpandedChange,
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

  const linkedKnowledgeBaseSpaceId = useMemo(
    () => activeTaskForSpace?.knowledgeBaseSpaceId?.trim() ?? '',
    [activeTaskForSpace?.knowledgeBaseSpaceId]
  )

  /** Task-scoped file tree: always a Set when this space’s active task is open (may be empty). */
  const taskProjectRootSetForSpace = useMemo(() => {
    if (!activeTaskForSpace) return null
    return new Set([...activeTaskForSpace.projectDirs, ...(activeTaskForSpace.touchedProjectDirs ?? [])])
  }, [activeTaskForSpace])

  const taskProjectDirNamesForGit = useMemo(() => {
    if (!taskProjectRootSetForSpace || taskProjectRootSetForSpace.size === 0) return undefined
    return Array.from(taskProjectRootSetForSpace).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    )
  }, [taskProjectRootSetForSpace])

  // ── All useState / useRef declarations first (avoids bundler TDZ issues) ──
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  // Use external control if provided, otherwise internal state
  const isControlled = externalExpanded !== undefined
  const [internalExpanded, setInternalExpanded] = useState(true)
  const isExpanded = isControlled ? externalExpanded : internalExpanded

  const [width, setWidth] = useState(initialWidth != null ? clampWidth(initialWidth) : DEFAULT_WIDTH)
  const widthRef = useRef(width)
  const [isDragging, setIsDragging] = useState(false)
  const [railMainTab, setRailMainTab] = useState<RailMainTab>(getInitialRailMainTab)
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const onWidthChangeRef = useRef(onWidthChange)
  onWidthChangeRef.current = onWidthChange
  const isGenerating = useIsGenerating()
  const { isActive: isOnboarding, currentStep, completeOnboarding } = useOnboardingStore()
  const isMobile = useIsMobile()

  // ── Callbacks ──

  const folderTargetSpaceId = useMemo(
    () =>
      railMainTab === 'knowledge-base' && linkedKnowledgeBaseSpaceId
        ? linkedKnowledgeBaseSpaceId
        : spaceId,
    [railMainTab, linkedKnowledgeBaseSpaceId, spaceId]
  )

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

  // Handle expand/collapse toggle
  const handleToggleExpanded = useCallback(() => {
    const newExpanded = !isExpanded

    // UI-first optimization: When Canvas is open, directly update DOM
    // before React state update to ensure layout resizes immediately
    if (isCanvasOpen && railRef.current) {
      const targetWidth = newExpanded ? width : COLLAPSED_WIDTH
      railRef.current.style.width = `${targetWidth}px`
    }

    // Then update React state (will re-render but width is already correct)
    if (isControlled) {
      onExpandedChange?.(newExpanded)
    } else {
      setInternalExpanded(newExpanded)
    }
  }, [isExpanded, isControlled, onExpandedChange, isCanvasOpen, width])

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

  const setRailMainTabPersist = useCallback((tab: RailMainTab) => {
    setRailMainTab(tab)
    try {
      if (tab !== 'knowledge-base') {
        localStorage.setItem(RAIL_MAIN_TAB_KEY, tab)
      }
    } catch {
      /* ignore quota */
    }
  }, [])

  const expandRailAndOpenKnowledgeBaseTab = useCallback(() => {
    setRailMainTabPersist('knowledge-base')
    if (isControlled) {
      onExpandedChange?.(true)
    } else {
      setInternalExpanded(true)
    }
  }, [isControlled, onExpandedChange, setRailMainTabPersist])

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

  // Handle opening browser - also collapse the rail to maximize browser area
  const handleOpenBrowser = useCallback(() => {
    getBrowserHomepage().then(url => openUrl(url, t('Browser')))
    // Auto-collapse rail when opening browser to maximize viewing area
    if (isControlled) {
      onExpandedChange?.(false)
    } else {
      setInternalExpanded(false)
    }
  }, [openUrl, isControlled, onExpandedChange])

  // Shared content renderer
  const renderContent = () => (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {railMainTab === 'source-control' ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <GitSourceControlPanel spaceId={spaceId} taskProjectDirNames={taskProjectDirNamesForGit} />
        </div>
      ) : railMainTab === 'workspace-find' ? (
        <RailWorkspaceFindPanel spaceId={spaceId} isWebMode={isWebMode} />
      ) : railMainTab === 'knowledge-base' ? (
        linkedKnowledgeBaseSpaceId ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ArtifactTree
              key={`rail-knowledge-base-${linkedKnowledgeBaseSpaceId}`}
              spaceId={linkedKnowledgeBaseSpaceId}
              taskProjectRootSet={null}
              taskFocusSessionId={null}
              taskNoExplicitProjectDirs={false}
              onboardingHighlightFileName={isOnboardingViewStep ? ONBOARDING_ARTIFACT_NAME : undefined}
              onboardingArtifactActivate={isOnboardingViewStep ? handleOnboardingArtifactClick : undefined}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0" aria-hidden />
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <ArtifactTree
            key={`rail-workspace-${spaceId}-${activeTaskForSpace?.id ?? 'none'}`}
            spaceId={spaceId}
            taskProjectRootSet={taskProjectRootSetForSpace}
            taskFocusSessionId={activeTaskForSpace?.id ?? null}
            taskNoExplicitProjectDirs={
              activeTaskForSpace != null && activeTaskForSpace.projectDirs.length === 0
            }
            onboardingHighlightFileName={isOnboardingViewStep ? ONBOARDING_ARTIFACT_NAME : undefined}
            onboardingArtifactActivate={isOnboardingViewStep ? handleOnboardingArtifactClick : undefined}
          />
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
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg transition-colors"
            title={t('Open folder (⌘⇧F)')}
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>{t('Open folder')}</span>
          </button>
          {/* Open browser button */}
          <button
            onClick={handleOpenBrowser}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg transition-colors"
            title={t('Open browser (⌘⇧B)')}
          >
            <Globe className="w-4 h-4 text-blue-500" />
            <span>{t('Open browser')}</span>
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
                    onClick={() => setRailMainTabPersist('files')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${railMainTab === 'files' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Files')}
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRailMainTabPersist('source-control')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${railMainTab === 'source-control' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Git operations')}
                  >
                    <GitBranch className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRailMainTabPersist('workspace-find')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${railMainTab === 'workspace-find' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Search in files')}
                  >
                    <Search className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRailMainTabPersist('knowledge-base')}
                    className={`
                      h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                      hover:bg-secondary/80
                      ${railMainTab === 'knowledge-base' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={t('Show linked knowledge base file tree')}
                    aria-label={t('Show linked knowledge base file tree')}
                  >
                    <BookOpen className="w-5 h-5" aria-hidden />
                  </button>
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
  const displayWidth = isExpanded ? width : COLLAPSED_WIDTH

  return (
    <div
      ref={railRef}
      className="h-full flex-shrink-0 border-l border-border bg-card/30 flex flex-col relative"
      style={{
        width: displayWidth,
        // Disable transition when: dragging OR Canvas is open (prevent layout flicker)
        transition: (isDragging || isCanvasOpen) ? 'none' : 'width 0.2s ease'
      }}
    >
      {/* Drag handle - only show when expanded */}
      {isExpanded && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-20 ${
            isDragging ? 'bg-primary/50' : ''
          }`}
          onMouseDown={handleMouseDown}
          title={t('Drag to resize')}
        />
      )}

      {/* Header — tab targets ~40px for easier clicking */}
      <div className="flex-shrink-0 px-2 min-h-11 h-11 border-b border-border flex items-center justify-between gap-1">
        {isExpanded && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRailMainTabPersist('files')}
              className={`
                h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                hover:bg-secondary/80
                ${railMainTab === 'files' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={t('Files')}
            >
              <FolderOpen className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={() => setRailMainTabPersist('source-control')}
              className={`
                h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                hover:bg-secondary/80
                ${railMainTab === 'source-control' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={t('Git operations')}
            >
              <GitBranch className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={() => setRailMainTabPersist('workspace-find')}
              className={`
                h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                hover:bg-secondary/80
                ${railMainTab === 'workspace-find' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={t('Search in files')}
            >
              <Search className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={() => setRailMainTabPersist('knowledge-base')}
              className={`
                h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200
                hover:bg-secondary/80
                ${railMainTab === 'knowledge-base' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={t('Show linked knowledge base file tree')}
              aria-label={t('Show linked knowledge base file tree')}
            >
              <BookOpen className="w-[18px] h-[18px] sm:w-5 sm:h-5" aria-hidden />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleToggleExpanded}
          className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center hover:bg-secondary rounded-lg transition-colors"
          title={isExpanded ? t('Collapse') : t('Expand')}
        >
          <ChevronRight className={`w-[18px] h-[18px] sm:w-5 sm:h-5 transition-transform ${isExpanded ? '' : 'rotate-180'}`} />
        </button>
      </div>

      {/* Content + Footer — CSS-hidden when collapsed to preserve ArtifactTree folder expansion state */}
      <div className={`flex-1 flex flex-col overflow-hidden${isExpanded ? '' : ' hidden'}`}>
        {renderContent()}
        {renderFooter()}
      </div>

      {/* Collapsed state - show both folder and browser icons */}
      {!isExpanded && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2">
          {isWebMode ? (
            <div
              className="p-2 rounded-lg cursor-not-allowed opacity-50"
              title={t('Please open folder in client')}
            >
              <Monitor className="w-5 h-5 text-muted-foreground" />
            </div>
          ) : (
            <>
              <button
                onClick={handleOpenFolder}
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
                title={t('Open folder')}
              >
                <FolderOpen className="w-5 h-5 text-amber-500" />
              </button>
              <button
                type="button"
                onClick={expandRailAndOpenKnowledgeBaseTab}
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
                title={t('Show linked knowledge base file tree')}
                aria-label={t('Show linked knowledge base file tree')}
              >
                <BookOpen className="w-5 h-5 text-primary" aria-hidden />
              </button>
              <button
                onClick={handleOpenBrowser}
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
                title={t('Open browser')}
              >
                <Globe className="w-5 h-5 text-blue-500" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
