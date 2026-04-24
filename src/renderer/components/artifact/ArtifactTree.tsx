/**
 * ArtifactTree - Professional tree view using react-arborist
 * VSCode-style file explorer with virtual scrolling and lazy loading
 *
 * PERFORMANCE OPTIMIZED:
 * - Zero conversion: backend CachedTreeNode shape consumed directly (no intermediate types)
 * - O(1) node lookup: mutable Map<path, node> index avoids recursive tree traversal
 * - Mutable ref + revision counter: watcher updates mutate in place, single shallow copy triggers render
 * - CSS-only hover: no per-node React state for mouse events
 * - Lazy loading: children fetched on-demand when expanding folders
 */

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, createContext, useContext, useRef } from 'react'
import { Tree, NodeRendererProps, TreeApi, CreateHandler, RenameHandler, DeleteHandler, MoveHandler, NodeApi } from 'react-arborist'
import { api } from '../../api'
import { useCanvasStore, type OpenFileOptions } from '../../stores/canvas.store'
import type { ArtifactTreeNode, ArtifactTreeUpdateEvent } from '../../types'
import { FileIcon } from '../icons/ToolIcons'
import {
  ChevronRight,
  ChevronDown,
  Download,
  Eye,
  Loader2,
  FilePlus,
  FolderPlus,
  FolderInput,
  Edit3,
  Trash2,
  FolderOpen,
  Copy,
  GitBranch,
  LayoutGrid,
  ListFilter,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { canOpenInCanvas } from '../../constants/file-types'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import { useNotificationStore } from '../../stores/notification.store'
import { useFileOperations } from '../../hooks/useFileOperations'
import { useTaskStore } from '../../stores/task.store'

// Context to pass openFile function to tree nodes without each node subscribing to store
type OpenFileFn = (path: string, title?: string, options?: OpenFileOptions) => Promise<void>
const OpenFileContext = createContext<OpenFileFn | null>(null)
const SpaceIdContext = createContext<string>('')

/** Top-level project names in scope for the active task — null = no task highlighting */
const TaskFileTreeContext = createContext<Set<string> | null>(null)

/** True when task has no folders added via "add to task" and the tree is showing all workspace roots — dim every row */
const TaskDimAllWorkspaceRootsContext = createContext(false)

const isWebMode = api.isRemoteMode()

// Directories that should be visually dimmed (secondary importance)
const DIMMED_DIRS = new Set([
  // Dependencies
  'node_modules', 'vendor', 'venv', '.venv', 'Pods', 'bower_components',
  // Build outputs
  'dist', 'build', 'out', 'target', '.output', 'bin', 'obj',
  // Framework caches
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', '.webpack',
  // Version control
  '.git', '.svn', '.hg',
  // IDE/Editor
  '.idea', '.vscode', '.vs',
  // Test/Coverage
  'coverage', '.nyc_output', '__pycache__', '.pytest_cache', '.mypy_cache', '.tox',
  // Misc
  '.halo', 'logs', 'tmp', 'temp',
])

function isDimmed(name: string): boolean {
  if (name.startsWith('.')) return true
  return DIMMED_DIRS.has(name)
}

interface ArtifactTreeProps {
  spaceId: string
  /**
   * Workspace top-level folder names that belong to the active task (projectDirs + touched).
   * When non-null (including empty Set), the rail is in task file mode: filter toggle + dimming rules apply.
   */
  taskProjectRootSet?: Set<string> | null
  /** Stable id for the focused task session — used to reset default filter when switching tasks. */
  taskFocusSessionId?: string | null
  /** True if the focused task has no entries in projectDirs (nothing explicitly added to the task). */
  taskNoExplicitProjectDirs?: boolean
  /** Onboarding: spotlight target on this file name (matches `data-onboarding="artifact-card"`) */
  onboardingHighlightFileName?: string
  /** Called after the highlighted file is opened (e.g. complete onboarding) */
  onboardingArtifactActivate?: () => void
}

// Fixed offsets for tree height calculation (in pixels)
// 180px accounts for: header (60px) + toolbar (40px) + padding/margins (80px)
const TREE_HEIGHT_OFFSET = 180

// Row height for virtual scrolling (in pixels)
// 26px provides comfortable spacing for file/folder names with icons
const TREE_ROW_HEIGHT = 26

function useTreeHeight() {
  const [height, setHeight] = useState(() => window.innerHeight - TREE_HEIGHT_OFFSET)

  useEffect(() => {
    const handleResize = () => setHeight(window.innerHeight - TREE_HEIGHT_OFFSET)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return height
}

// Get parent directory path (supports both / and \ separators)
function getParentPath(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep > 0 ? filePath.substring(0, lastSep) : filePath
}

function topLevelWorkspaceName(n: ArtifactTreeNode): string {
  return (n.name || n.relativePath?.split(/[/\\]/).filter(Boolean)[0] || '').trim()
}

/** Root insert index in full root list when the tree UI shows only task roots (react-arborist index is scoped to visible roots). */
function resolveRootInsertIndexInFullList(
  fullRoots: ArtifactTreeNode[],
  visibleInsertIndex: number,
  taskSet: Set<string>
): number {
  const indices: number[] = []
  for (let i = 0; i < fullRoots.length; i++) {
    const top = topLevelWorkspaceName(fullRoots[i])
    if (top && taskSet.has(top)) indices.push(i)
  }
  if (indices.length === 0) return Math.min(visibleInsertIndex, fullRoots.length)
  if (visibleInsertIndex <= 0) return indices[0]
  if (visibleInsertIndex >= indices.length) return indices[indices.length - 1] + 1
  return indices[visibleInsertIndex]
}

/** Put workspace root entries that belong to the active task first (name matches task project roots). */
function sortRootNodesByTaskProjects(
  nodes: ArtifactTreeNode[],
  taskRootSet: Set<string> | null
): ArtifactTreeNode[] {
  if (!taskRootSet || taskRootSet.size === 0 || nodes.length <= 1) return nodes
  const inTask: ArtifactTreeNode[] = []
  const rest: ArtifactTreeNode[] = []
  for (const n of nodes) {
    const top = topLevelWorkspaceName(n)
    if (top && taskRootSet.has(top)) inTask.push(n)
    else rest.push(n)
  }
  if (inTask.length === 0) return nodes
  const cmp = (a: ArtifactTreeNode, b: ArtifactTreeNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  inTask.sort(cmp)
  rest.sort(cmp)
  return [...inTask, ...rest]
}

// Context for lazy loading children
interface LazyLoadContextType {
  loadChildren: (path: string) => Promise<void>
  loadingPaths: Set<string>
}
const LazyLoadContext = createContext<LazyLoadContextType | null>(null)

interface OnboardingTreeContextType {
  highlightFileName: string | null
  onActivate: (() => void) | null
}
const OnboardingTreeContext = createContext<OnboardingTreeContextType | null>(null)

/** Actions for the "添加到任务 / 从任务移除" right-click menu item */
interface TaskActionsCtx {
  activeTaskId: string
  projectDirs: Set<string>
  addDir: (dir: string) => void
  removeDir: (dir: string) => void
}
const TaskActionsContext = createContext<TaskActionsCtx | null>(null)

// ============================================
// Index helpers — maintain Map<path, node> for O(1) lookup
// ============================================

/** Add direct children to the index (non-recursive — deeper nodes indexed on expand) */
function indexNodes(nodes: ArtifactTreeNode[], index: Map<string, ArtifactTreeNode>): void {
  for (const node of nodes) {
    index.set(node.path, node)
  }
}

/** Remove a node and its entire expanded subtree from the index */
function removeSubtreeFromIndex(node: ArtifactTreeNode, index: Map<string, ArtifactTreeNode>): void {
  index.delete(node.path)
  if (node.children) {
    for (const child of node.children) {
      removeSubtreeFromIndex(child, index)
    }
  }
}

/**
 * Merge incoming children (from watcher or IPC) with existing children.
 * Preserves react-arborist node id (key stability) and expanded folder state.
 * Maintains the path→node index as a side effect.
 */
function mergeChildren(
  incoming: ArtifactTreeNode[],
  existing: ArtifactTreeNode[],
  index: Map<string, ArtifactTreeNode>,
  recentlyCreatedPaths?: Map<string, number>
): ArtifactTreeNode[] {
  const existingByPath = new Map(existing.map(n => [n.path, n]))

  // Remove deleted nodes from index
  const incomingPaths = new Set(incoming.map(n => n.path))
  for (const node of existing) {
    if (!incomingPaths.has(node.path)) {
      removeSubtreeFromIndex(node, index)
    }
  }

  return incoming.map(node => {
    const prev = existingByPath.get(node.path)
    if (prev) {
      // Preserve react-arborist key — but skip temp nodes so they get replaced
      // with the real backend ID and don't pollute subsequent rename checks
      if (!prev.id.startsWith('temp-')) {
        node.id = prev.id
      }
      // Preserve expanded state: keep children the user already loaded
      if (prev.childrenLoaded && prev.children) {
        node.children = prev.children
        node.childrenLoaded = prev.childrenLoaded
      }
    }
    index.set(node.path, node)
    return node
  })
}

// ============================================
// ArtifactTree component
// ============================================

export function ArtifactTree({
  spaceId,
  taskProjectRootSet,
  taskFocusSessionId = null,
  taskNoExplicitProjectDirs = false,
  onboardingHighlightFileName,
  onboardingArtifactActivate,
}: ArtifactTreeProps) {
  const { t } = useTranslation()
  /** null = not in task file mode; Set (possibly empty) = task session active */
  const effectiveTaskRootSet = useMemo(
    () => (taskProjectRootSet != null ? taskProjectRootSet : null),
    [taskProjectRootSet]
  )
  const effectiveTaskRootSetRef = useRef(effectiveTaskRootSet)
  effectiveTaskRootSetRef.current = effectiveTaskRootSet
  const [showAllSpaceProjects, setShowAllSpaceProjects] = useState(false)
  const showAllSpaceProjectsRef = useRef(showAllSpaceProjects)
  showAllSpaceProjectsRef.current = showAllSpaceProjects

  const prevTaskFocusIdRef = useRef<string | null>(null)
  const prevTaskRootSizeRef = useRef<number>(-1)

  useEffect(() => {
    if (taskFocusSessionId == null || effectiveTaskRootSet == null) {
      prevTaskFocusIdRef.current = null
      prevTaskRootSizeRef.current = -1
      setShowAllSpaceProjects(false)
      return
    }
    const sz = effectiveTaskRootSet.size
    if (prevTaskFocusIdRef.current !== taskFocusSessionId) {
      prevTaskFocusIdRef.current = taskFocusSessionId
      prevTaskRootSizeRef.current = sz
      setShowAllSpaceProjects(sz === 0)
      return
    }
    const prev = prevTaskRootSizeRef.current
    prevTaskRootSizeRef.current = sz
    if (prev === 0 && sz > 0) {
      setShowAllSpaceProjects(false)
    } else if (prev > 0 && sz === 0) {
      setShowAllSpaceProjects(true)
    }
  }, [taskFocusSessionId, effectiveTaskRootSet])

  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const treeHeight = useTreeHeight()
  /** Bumped on each spaceId change so in-flight loadChildren cannot mutate a stale tree. */
  const spaceEpochRef = useRef(0)
  const treeRef = useRef<TreeApi<ArtifactTreeNode>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { showConfirm, DialogComponent } = useConfirmDialog()
  
  // Workspace root — authoritative absolute path from backend, used for path construction
  const workspaceRootRef = useRef<string>('')

  // File operations hook
  const {
    createNewArtifact,
    renameExistingArtifact,
    deleteArtifact,
    moveArtifact,
    recentlyCreatedPaths,
    cleanup: cleanupFileOperations
  } = useFileOperations({ spaceId, workspaceRootRef })

  // Task actions — for "添加到任务" context menu item on top-level folders
  const taskForThisSpace = useTaskStore(s =>
    s.tasks.find(t => t.id === s.activeTaskId && t.spaceId === spaceId) ?? null
  )
  const addProjectDirToTask = useTaskStore(s => s.addProjectDirToTask)
  const removeProjectDirFromTask = useTaskStore(s => s.removeProjectDirFromTask)
  const taskActionsValue = useMemo<TaskActionsCtx | null>(() => {
    if (!taskForThisSpace) return null
    return {
      activeTaskId: taskForThisSpace.id,
      projectDirs: new Set(taskForThisSpace.projectDirs),
      addDir: (dir) => addProjectDirToTask(taskForThisSpace.id, dir),
      removeDir: (dir) => removeProjectDirFromTask(taskForThisSpace.id, dir),
    }
  }, [taskForThisSpace, addProjectDirToTask, removeProjectDirFromTask])

  // Whether the initial IPC load has completed (distinguishes "loading" from "truly empty")
  const [hasLoaded, setHasLoaded] = useState(false)
  
  // Mutable tree data + path→node index (avoids full-tree immutable copies)
  const nodeIndex = useRef<Map<string, ArtifactTreeNode>>(new Map())
  const treeDataRef = useRef<ArtifactTreeNode[]>([])
  // Revision counter — incrementing triggers react-arborist to pick up mutated data
  const [revision, setRevision] = useState(0)

  /** Discards out-of-order listArtifactsTree responses when spaceId or load calls race. */
  const latestTreeLoadIdRef = useRef(0)
  /** Watcher events always compared to latest space (stable handler + ref avoids stale closures). */
  const treeBoundSpaceIdRef = useRef(spaceId)
  treeBoundSpaceIdRef.current = spaceId

  const openFile = useCanvasStore(state => state.openFile)

  useLayoutEffect(() => {
    spaceEpochRef.current += 1
  }, [spaceId])

  // Load tree data (root level only for lazy loading)
  const loadTree = useCallback(async () => {
    if (!spaceId) return
    const loadId = ++latestTreeLoadIdRef.current
    const epochAtStart = spaceEpochRef.current
    setHasLoaded(false)

    try {
      const response = await api.listArtifactsTree(spaceId)
      if (loadId !== latestTreeLoadIdRef.current || epochAtStart !== spaceEpochRef.current) return
      if (response.success && response.data) {
        const { workspaceRoot, nodes } = response.data as { workspaceRoot: string; nodes: ArtifactTreeNode[] }
        workspaceRootRef.current = workspaceRoot
        const sortedRoot = sortRootNodesByTaskProjects(nodes, effectiveTaskRootSetRef.current)
        treeDataRef.current = sortedRoot
        nodeIndex.current.clear()
        indexNodes(sortedRoot, nodeIndex.current)
        setRevision(r => r + 1)
      } else {
        console.warn('[ArtifactTree] loadTree: response not successful or no data', response)
      }
    } catch (error) {
      console.error('[ArtifactTree] Failed to load tree:', error)
    } finally {
      if (loadId === latestTreeLoadIdRef.current && epochAtStart === spaceEpochRef.current) {
        setHasLoaded(true)
      }
    }
  }, [spaceId])

  // onCreate - Create temporary node
  const handleCreate: CreateHandler<ArtifactTreeNode> = useCallback(async (args) => {
    const { parentNode, index, type } = args
    // Create a temporary node — real file is created in handleRename on submit
    const tempId = `temp-${Date.now()}`
    const parentPath = parentNode?.data.path || workspaceRootRef.current

    const tempNode: ArtifactTreeNode = {
      id: tempId,
      name: '',
      path: parentPath ? `${parentPath}/${tempId}` : tempId,
      relativePath: tempId,
      type: type === 'leaf' ? 'file' : 'folder',
      extension: '',
      icon: type === 'leaf' ? 'file' : 'folder',
      depth: 0,
      children: type === 'internal' ? [] : undefined,
      childrenLoaded: type === 'internal' ? true : false
    }

    // Mutate tree in place then bump revision — avoids deep cloning the full tree.
    // react-arborist virtual scrolling means only ~20-30 visible nodes re-render.
    if (parentNode) {
      if (!parentNode.data.children) {
        parentNode.data.children = []
      }
      parentNode.data.children.splice(index, 0, tempNode)
      parentNode.data.childrenLoaded = true
    } else {
      const taskSet = effectiveTaskRootSetRef.current
      const showAll = showAllSpaceProjectsRef.current
      if (taskSet && taskSet.size > 0 && !showAll) {
        const pos = resolveRootInsertIndexInFullList(treeDataRef.current, index, taskSet)
        treeDataRef.current.splice(pos, 0, tempNode)
      } else {
        treeDataRef.current.splice(index, 0, tempNode)
      }
    }

    nodeIndex.current.set(tempNode.path, tempNode)
    setRevision(r => r + 1)

    // Select the temp node once the tree has re-rendered
    requestAnimationFrame(() => {
      const tree = treeRef.current
      if (tree) {
        const newNode = tree.get(tempId)
        if (newNode) {
          // Only select, don't focus - editing mode will handle the input focus
          newNode.select()
        }
      }
    })
    
    return tempNode
  }, [])

  // onRename - Create real file or rename existing file
  const handleRename: RenameHandler<ArtifactTreeNode> = useCallback(async (args) => {
    const { id, name, node } = args
    const newName = name.trim()

    if (!newName) {
      // Clean up temp node if creation was cancelled with empty name
      if (id.toString().startsWith('temp-')) {
        const rootIdx = treeDataRef.current.findIndex(n => n.id === id)
        if (rootIdx !== -1) {
          treeDataRef.current.splice(rootIdx, 1)
        } else if (node.parent?.data?.children) {
          const childIdx = (node.parent.data.children as ArtifactTreeNode[]).findIndex(c => c.id === id)
          if (childIdx !== -1) {
            (node.parent.data.children as ArtifactTreeNode[]).splice(childIdx, 1)
          }
        }
        nodeIndex.current.delete(node.data.path)
        setRevision(r => r + 1)
      }
      return
    }

    // Check if this is a new file (temp ID) or rename
    const isCreating = id.toString().startsWith('temp-')

    if (isCreating) {
      const result = await createNewArtifact(node, newName)
      if (result.success && result.resolvedPath) {
        // Update node path and index with the real absolute path from backend.
        // This ensures that if the user immediately creates a child inside this node,
        // the parent path is correct (not a stale temp- placeholder).
        const oldPath = node.data.path
        node.data.path = result.resolvedPath
        nodeIndex.current.delete(oldPath)
        nodeIndex.current.set(result.resolvedPath, node.data)
      }
    } else {
      await renameExistingArtifact(node, newName)
    }

    // File watcher will automatically update tree
  }, [createNewArtifact, renameExistingArtifact])

  // onDelete - Delete file/folder with confirmation
  const handleDelete: DeleteHandler<ArtifactTreeNode> = useCallback(async (args) => {
    const { ids, nodes } = args
    const fileName = nodes[0].data.name
    const count = ids.length
    
    // Check if any nodes are temporary (being created)
    const hasTempNodes = nodes.some((n: NodeApi<ArtifactTreeNode>) => n.id.toString().startsWith('temp-'))
    
    if (hasTempNodes) {
      // Cancel in-progress creation — remove temp nodes, no confirmation needed
      for (const node of nodes) {
        const isRootNode = !node.parent || node.parent.id === '__REACT_ARBORIST_INTERNAL_ROOT__'
        
        if (isRootNode) {
          // Remove from root
          const index = treeDataRef.current.findIndex(n => n.id === node.id)
          if (index !== -1) {
            treeDataRef.current.splice(index, 1)
          }
        } else {
          // Remove from parent's children
          const parent = node.parent?.data
          if (parent?.children) {
            const index = parent.children.findIndex((c: ArtifactTreeNode) => c.id === node.id)
            if (index !== -1) {
              parent.children.splice(index, 1)
            }
          }
        }
        
        // Remove from index
        nodeIndex.current.delete(node.data.path)
      }
      
      // Trigger re-render
      setRevision(r => r + 1)
      return
    }
    
    // Show confirmation dialog for real files
    const confirmed = await showConfirm({
      title: count === 1
        ? t("Are you sure you want to delete '{{name}}'?", { name: fileName })
        : t('Are you sure you want to delete {{count}} items?', { count }),
      message: count === 1
        ? t('You can restore this file from the Trash.')
        : t('You can restore these files from the Trash.'),
      confirmLabel: t('Move to Trash'),
      cancelLabel: t('Cancel'),
      variant: 'danger'
    })
    
    if (!confirmed) return

    // Parallel delete — avoids sequential IPC round-trips for multi-file selections
    const results = await Promise.all(nodes.map(n => deleteArtifact(n.data.path)))
    const successCount = results.filter(Boolean).length
    const failCount = results.length - successCount
    
    // Show result notification
    if (successCount > 0) {
      useNotificationStore.getState().show({
        title: t('Deleted'),
        body: count === 1
          ? t("'{{name}}' moved to Trash", { name: fileName })
          : t('{{count}} items moved to Trash', { count: successCount }),
        variant: 'success',
        duration: 3000
      })
    }
    
    if (failCount > 0) {
      useNotificationStore.getState().show({
        title: t('Delete failed'),
        body: t('Failed to delete {{count}} items', { count: failCount }),
        variant: 'error',
        duration: 5000
      })
    }
    
    // File watcher will automatically update tree
  }, [spaceId, t, showConfirm, deleteArtifact])

  // onMove - Drag and drop move
  // Sends (oldPath, newParentPath) — backend constructs the destination path
  const handleMove: MoveHandler<ArtifactTreeNode> = useCallback(async (args) => {
    const { dragNodes, parentNode } = args
    const newParentPath = parentNode?.data.path || ''

    for (const node of dragNodes) {
      const oldPath = node.data.path

      // Prevent moving a folder into one of its own descendants
      if (newParentPath.startsWith(oldPath + '/') || newParentPath === oldPath) {
        useNotificationStore.getState().show({
          title: t('Move failed'),
          body: t('Cannot move a folder into itself'),
          variant: 'error',
          duration: 3000
        })
        continue
      }

      await moveArtifact(oldPath, newParentPath)
    }

    // File watcher will automatically update tree
  }, [t, moveArtifact])

  // Toolbar button handlers
  const handleNewFile = useCallback(() => {
    const tree = treeRef.current
    if (!tree) return
    const focusedNode = tree.focusedNode

    if (!focusedNode) {
      // Nothing selected: create at end of visible roots
      // Use tree.root.children length (= displayedRoots count) so the temp node
      // lands within the filtered view in task mode, not outside it.
      const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
      tree.create({ type: 'leaf', parentId: null, index: visibleRootCount })
      return
    }

    if (focusedNode.data.type === 'folder') {
      // Focused folder: create inside it
      if (!focusedNode.isOpen) focusedNode.open()
      tree.create({ type: 'leaf', parentId: focusedNode.id })
    } else {
      // Focused file: create alongside it in the same folder
      const parentNode = focusedNode.parent
      const isRootLevel = !parentNode || parentNode.id === '__REACT_ARBORIST_INTERNAL_ROOT__'
      if (isRootLevel) {
        const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
        tree.create({ type: 'leaf', parentId: null, index: visibleRootCount })
      } else {
        tree.create({ type: 'leaf', parentId: parentNode.id })
      }
    }
  }, [])

  const handleNewFolder = useCallback(() => {
    const tree = treeRef.current
    if (!tree) return
    const focusedNode = tree.focusedNode

    if (!focusedNode) {
      const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
      tree.create({ type: 'internal', parentId: null, index: visibleRootCount })
      return
    }

    if (focusedNode.data.type === 'folder') {
      if (!focusedNode.isOpen) focusedNode.open()
      tree.create({ type: 'internal', parentId: focusedNode.id })
    } else {
      const parentNode = focusedNode.parent
      const isRootLevel = !parentNode || parentNode.id === '__REACT_ARBORIST_INTERNAL_ROOT__'
      if (isRootLevel) {
        const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
        tree.create({ type: 'internal', parentId: null, index: visibleRootCount })
      } else {
        tree.create({ type: 'internal', parentId: parentNode.id })
      }
    }
  }, [])

  // Blank-area right-click handlers — always create at root (no focused node influence)
  // Use visible root count so temp node lands within the filtered view in task mode
  const handleNewFileAtRoot = useCallback(() => {
    const tree = treeRef.current
    if (!tree) return
    const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
    tree.create({ type: 'leaf', parentId: null, index: visibleRootCount })
  }, [])

  const handleNewFolderAtRoot = useCallback(() => {
    const tree = treeRef.current
    if (!tree) return
    const visibleRootCount = tree.root.children?.length ?? treeDataRef.current.length
    tree.create({ type: 'internal', parentId: null, index: visibleRootCount })
  }, [])

  // Keyboard shortcuts — scoped to tree container to avoid conflicts with other inputs
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tree = treeRef.current
      if (!tree) return

      // Skip if an input/textarea is focused (e.g. inline rename)
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      // F2 - Rename
      if (e.key === 'F2') {
        e.preventDefault()
        const focusedNode = tree.focusedNode
        if (focusedNode) {
          focusedNode.edit()
        }
      }

      // Delete / Backspace - Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const selectedNodes = tree.selectedNodes
        if (selectedNodes.length > 0) {
          tree.delete(selectedNodes.map(n => n.id))
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Lazy load children for a folder — mutates ref in place, O(1) lookup
  const loadChildren = useCallback(async (dirPath: string): Promise<void> => {
    if (!spaceId) return
    const epochAtStart = spaceEpochRef.current

    try {
      setLoadingPaths(prev => new Set(prev).add(dirPath))
      const response = await api.loadArtifactChildren(spaceId, dirPath)

      if (epochAtStart !== spaceEpochRef.current) return

      if (response.success && response.data) {
        const children = response.data as ArtifactTreeNode[]
        const parent = nodeIndex.current.get(dirPath)
        if (parent) {
          parent.children = children
          parent.childrenLoaded = true
          indexNodes(children, nodeIndex.current)
          setRevision(r => r + 1)
        } else {
          console.warn('[ArtifactTree] loadChildren: parent not in index — path=%s', dirPath)
        }
      } else {
        console.warn('[ArtifactTree] loadChildren: empty response — path=%s', dirPath)
      }
    } catch (error) {
      console.error('[ArtifactTree] Failed to load children:', error)
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }, [spaceId])

  // Handle tree update events from watcher (pre-computed data, zero IPC round-trips)
  // O(1) node lookup via index, mutate in place, single revision bump
  const handleTreeUpdate = useCallback((data: {
    spaceId: string
    updatedDirs: Array<{ dirPath: string; children: unknown[] }>
    changes: Array<{
      type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
      path: string
      relativePath: string
      spaceId: string
      item?: unknown
    }>
  }) => {
    if (data.spaceId !== treeBoundSpaceIdRef.current || data.updatedDirs.length === 0) return

    for (const { dirPath, children } of data.updatedDirs) {
      const incomingChildren = children as ArtifactTreeNode[]
      const parent = nodeIndex.current.get(dirPath)

      if (parent) {
        // Known expanded directory — O(1) lookup, merge children
        parent.children = mergeChildren(incomingChildren, parent.children || [], nodeIndex.current, recentlyCreatedPaths.current)
        parent.childrenLoaded = true
      } else {
        // Root-level update or initial load
        const isRoot = treeDataRef.current.length > 0 &&
          treeDataRef.current.some(n => getParentPath(n.path) === dirPath)
        if (isRoot || treeDataRef.current.length === 0) {
          const merged = mergeChildren(
            incomingChildren,
            treeDataRef.current,
            nodeIndex.current,
            recentlyCreatedPaths.current
          )
          treeDataRef.current = sortRootNodesByTaskProjects(merged, effectiveTaskRootSetRef.current)
        }
        // Else: untracked directory — loaded on first expand
      }
    }

    setRevision(r => r + 1)
  }, [])

  // Initialize watcher and subscribe to changes
  useEffect(() => {
    if (!spaceId) return

    api.initArtifactWatcher(spaceId).catch(err => {
      console.error('[ArtifactTree] Failed to init watcher:', err)
    })

    const cleanup = api.onArtifactTreeUpdate(handleTreeUpdate)

    return () => {
      cleanup()
    }
  }, [spaceId, handleTreeUpdate])

  // Load on mount and when space changes
  useEffect(() => {
    loadTree()
  }, [loadTree])

  // Re-order root when task project set changes (e.g. add-to-task) without full tree reload
  useEffect(() => {
    if (!hasLoaded || treeDataRef.current.length === 0) return
    const sorted = sortRootNodesByTaskProjects(treeDataRef.current, effectiveTaskRootSetRef.current)
    const unchanged =
      sorted.length === treeDataRef.current.length &&
      sorted.every((n, i) => n === treeDataRef.current[i])
    if (unchanged) return
    treeDataRef.current = sorted
    setRevision((r) => r + 1)
  }, [effectiveTaskRootSet, hasLoaded])

  // Cleanup all pending timeouts on unmount
  useEffect(() => {
    return () => {
      cleanupFileOperations()
    }
  }, [cleanupFileOperations])

  // Auto-select recently created files after each revision commit.
  // useEffect runs after React commits the DOM, so react-arborist has already rendered
  // the new nodes — no requestAnimationFrame timing hack needed.
  useEffect(() => {
    if (recentlyCreatedPaths.current.size === 0) return
    const tree = treeRef.current
    if (!tree) return
    for (const path of Array.from(recentlyCreatedPaths.current.keys())) {
      const nodeData = nodeIndex.current.get(path)
      if (nodeData) {
        const node = tree.get(nodeData.id)
        if (node) {
          node.select()
          recentlyCreatedPaths.current.delete(path)
        }
      }
    }
  }, [revision])

  // Full workspace roots (authoritative); filtering only affects what we pass to react-arborist
  const treeData = useMemo(() => [...treeDataRef.current], [revision])

  const displayedRoots = useMemo(() => {
    const full = treeDataRef.current
    const taskSet = effectiveTaskRootSet
    if (!taskSet) {
      return [...full]
    }
    if (taskSet.size === 0 || showAllSpaceProjects) {
      return [...full]
    }
    return full.filter((n) => {
      // Always show temp nodes (in-progress creation) so the rename input is visible
      if (n.id.startsWith('temp-')) return true
      const top = topLevelWorkspaceName(n)
      return top && taskSet.has(top)
    })
  }, [revision, showAllSpaceProjects, effectiveTaskRootSet])

  const taskScopeForDimming =
    effectiveTaskRootSet && effectiveTaskRootSet.size > 0 && showAllSpaceProjects
      ? effectiveTaskRootSet
      : null

  const dimAllWorkspaceRoots = useMemo(() => {
    if (effectiveTaskRootSet == null || !taskNoExplicitProjectDirs) return false
    return effectiveTaskRootSet.size === 0 || showAllSpaceProjects
  }, [effectiveTaskRootSet, taskNoExplicitProjectDirs, showAllSpaceProjects])

  const lazyLoadValue = useMemo(() => ({
    loadChildren,
    loadingPaths
  }), [loadChildren, loadingPaths])

  const onboardingTreeValue = useMemo<OnboardingTreeContextType | null>(() => {
    if (!onboardingHighlightFileName || !onboardingArtifactActivate) return null
    return {
      highlightFileName: onboardingHighlightFileName,
      onActivate: onboardingArtifactActivate,
    }
  }, [onboardingHighlightFileName, onboardingArtifactActivate])

  const fullRootCount = treeData.length

  // Three-state empty check: loading → show nothing; loaded & empty → "No files"
  if (displayedRoots.length === 0) {
    if (!hasLoaded) {
      // Still loading — render empty container to avoid "No files" flash
      return null
    }
    if (fullRootCount > 0 && effectiveTaskRootSet && effectiveTaskRootSet.size > 0 && !showAllSpaceProjects) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-2">
          <div className="w-10 h-10 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center mb-2">
            <FolderOpen className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground">{t('No folders match this task yet')}</p>
          <button
            type="button"
            onClick={() => setShowAllSpaceProjects(true)}
            className="mt-3 text-[11px] text-primary hover:underline"
          >
            {t('Show all workspace folders')}
          </button>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-2">
        <div className="w-10 h-10 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center mb-2">
          <ChevronRight className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="text-xs text-muted-foreground">{t('No files')}</p>
      </div>
    )
  }

  return (
    <TaskActionsContext.Provider value={taskActionsValue}>
    <TaskDimAllWorkspaceRootsContext.Provider value={dimAllWorkspaceRoots}>
    <TaskFileTreeContext.Provider value={taskScopeForDimming}>
    <OpenFileContext.Provider value={openFile}>
      <SpaceIdContext.Provider value={spaceId}>
      <OnboardingTreeContext.Provider value={onboardingTreeValue}>
      <LazyLoadContext.Provider value={lazyLoadValue}>
        <div ref={containerRef} tabIndex={-1} className="flex flex-col h-full outline-none">
          {/* Override react-arborist focus-visible styles */}
          <style>{`
            [role="treeitem"]:focus-visible {
              outline: none !important;
            }
          `}</style>
          
          {/* Header with toolbar */}
          <div className="flex-shrink-0 bg-card px-2 py-1.5 border-b border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/80 [.light_&]:text-muted-foreground uppercase tracking-wider">
                {t('File navigation bar')}
              </span>
              <div className="flex gap-1 items-center">
                {effectiveTaskRootSet != null ? (
                  <button
                    type="button"
                    onClick={() => setShowAllSpaceProjects((v) => !v)}
                    className={`
                      p-1 rounded transition-colors
                      ${showAllSpaceProjects ? 'bg-secondary/80 text-primary' : 'hover:bg-secondary/60 text-muted-foreground hover:text-foreground'}
                    `}
                    title={
                      showAllSpaceProjects
                        ? t('Show only task folders')
                        : t('Show all workspace folders')
                    }
                    aria-label={
                      showAllSpaceProjects
                        ? t('Show only task folders')
                        : t('Show all workspace folders')
                    }
                    aria-pressed={showAllSpaceProjects}
                  >
                    {showAllSpaceProjects ? (
                      <ListFilter className="w-3.5 h-3.5" aria-hidden />
                    ) : (
                      <LayoutGrid className="w-3.5 h-3.5" aria-hidden />
                    )}
                  </button>
                ) : null}
                <button 
                  onClick={handleNewFile}
                  className="p-1 hover:bg-secondary/60 rounded transition-colors"
                  title={t('New File')}
                >
                  <FilePlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
                <button 
                  onClick={handleNewFolder}
                  className="p-1 hover:bg-secondary/60 rounded transition-colors"
                  title={t('New Folder')}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            </div>
          </div>

          {/* Tree — uses window height based calculation */}
          <ContextMenu
            className="flex-1 overflow-hidden"
            items={[
              {
                label: t('New File'),
                icon: <FilePlus className="w-4 h-4" />,
                onClick: handleNewFileAtRoot,
              },
              {
                label: t('New Folder'),
                icon: <FolderPlus className="w-4 h-4" />,
                onClick: handleNewFolderAtRoot,
              },
            ]}
          >
            <Tree<ArtifactTreeNode>
              key={`arborist-${spaceId}`}
              ref={treeRef}
              data={displayedRoots}
              openByDefault={false}
              width="100%"
              height={treeHeight}
              indent={16}
              rowHeight={TREE_ROW_HEIGHT}
              overscanCount={5}
              paddingTop={4}
              paddingBottom={4}
              disableDrag={false}
              disableDrop={false}
              disableEdit={false}
              onCreate={handleCreate}
              onRename={handleRename}
              onDelete={handleDelete}
              onMove={handleMove}
            >
              {TreeNodeComponent}
            </Tree>
          </ContextMenu>
        </div>

        {/* Confirmation dialog */}
        {DialogComponent}
      </LazyLoadContext.Provider>
      </OnboardingTreeContext.Provider>
      </SpaceIdContext.Provider>
    </OpenFileContext.Provider>
    </TaskFileTreeContext.Provider>
    </TaskDimAllWorkspaceRootsContext.Provider>
    </TaskActionsContext.Provider>
  )
}

// ============================================
// Tree node renderer — CSS-only hover, no per-node state
// ============================================

// Editing state node component
function EditingNode({ node, style, dragHandle, tree }: NodeRendererProps<ArtifactTreeNode>) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(node.data.name || '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const data = node.data
  
  // Auto-focus and select text
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      
      const value = inputRef.current.value
      if (value) {
        // Select text, but not including extension
        const dotIndex = value.lastIndexOf('.')
        if (dotIndex > 0 && !node.isLeaf) {
          // Folder: select all
          inputRef.current.select()
        } else if (dotIndex > 0) {
          // File: select up to extension
          inputRef.current.setSelectionRange(0, dotIndex)
        } else {
          // No extension: select all
          inputRef.current.select()
        }
      }
    }
  }, [node.isLeaf])
  
  // Check if name already exists in parent directory
  const checkNameExists = useCallback((name: string): boolean => {
    if (!name) return false
    
    const isCreating = node.id.toString().startsWith('temp-')
    
    const siblings: NodeApi<ArtifactTreeNode>[] =
      node.parent && node.parent.id !== '__REACT_ARBORIST_INTERNAL_ROOT__'
        ? node.parent.children || []
        : node.tree.root.children || []

    return siblings.some(sibling => {
      if (!sibling?.data) return false
      if (!isCreating && sibling.id === node.id) return false
      return sibling.data.name === name
    })
  }, [node])
  
  // Validate input value
  const validateInput = useCallback((value: string) => {
    const trimmed = value.trim()
    
    if (!trimmed) {
      setErrorMessage(null)
      return
    }
    
    // Check for invalid characters (platform-specific)
    const invalidChars = /[<>:"|?*\x00-\x1f]/
    if (invalidChars.test(trimmed)) {
      setErrorMessage(t('A file or folder name cannot contain any of the following characters: \\ / : * ? " < > |'))
      return
    }
    
    // Check for forward/backward slashes (path separators)
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      setErrorMessage(t('A file or folder name cannot contain any of the following characters: \\ / : * ? " < > |'))
      return
    }
    
    // Check for names that are only dots (., .., etc.)
    if (/^\.+$/.test(trimmed)) {
      setErrorMessage(t('A file or folder name cannot be "." or ".."'))
      return
    }
    
    // Windows-specific restrictions (only apply on Windows platform)
    const isWindows = window.platform?.isWindows ?? false
    if (isWindows) {
      // Check for trailing dots or spaces (Windows restriction)
      if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
        setErrorMessage(t('A file or folder name cannot end with a dot or space'))
        return
      }
      
      // Check for reserved names on Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
      const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
      const nameWithoutExt = trimmed.split('.')[0]
      if (reservedNames.test(nameWithoutExt)) {
        setErrorMessage(t('This name is reserved by the system. Please choose a different name.'))
        return
      }
    }
    
    // Check if name already exists
    if (checkNameExists(trimmed)) {
      setErrorMessage(t("A file or folder '{{name}}' already exists at this location. Please choose a different name.", { name: trimmed }))
      return
    }
    
    setErrorMessage(null)
  }, [checkNameExists, t])
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    validateInput(value)
  }
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Check if this is a new node (temp ID)
    const isCreating = node.id.toString().startsWith('temp-')
    
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = e.currentTarget.value.trim()
      
      // Don't submit if there's an error
      if (errorMessage) {
        return
      }
      
      if (value) {
        node.submit(value)
      } else {
        isCreating ? node.tree.delete(node.id) : node.reset()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      isCreating ? node.tree.delete(node.id) : node.reset()
    }
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value.trim()
    const isCreating = node.id.toString().startsWith('temp-')

    if (errorMessage) {
      isCreating ? node.tree.delete(node.id) : node.reset()
      return
    }

    if (value) {
      node.submit(value)
    } else {
      isCreating ? node.tree.delete(node.id) : node.reset()
    }
  }
  
  return (
    <div
      ref={dragHandle}
      style={style}
      className="flex flex-col pr-2 relative"
    >
      <div className="flex items-center h-[26px]">
        {/* Indent space */}
        <span className="w-4 h-4 flex-shrink-0" />
        
        {/* Icon */}
        <span className="w-4 h-4 flex-shrink-0 mr-1.5">
          <FileIcon 
            extension={data.extension} 
            isFolder={data.type === 'folder'}
            size={16} 
          />
        </span>
        
        {/* Input wrapper for error message alignment */}
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={`w-full px-1 py-0.5 text-sm bg-background rounded focus:outline-none focus:ring-1 ${
              errorMessage
                ? 'border border-destructive focus:ring-destructive'
                : 'border border-primary focus:ring-primary'
            }`}
            spellCheck={false}
          />
          
          {/* Error message */}
          {errorMessage && (
            <div className="absolute top-full left-0 right-0 mt-0.5 z-50 px-2 py-1 text-[11px] text-destructive bg-destructive/10 rounded border border-destructive/20 shadow-md">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for Electron contexts where clipboard API may fail
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  })
}

function TreeNodeComponent({ node, style, dragHandle }: NodeRendererProps<ArtifactTreeNode>) {
  const { t } = useTranslation()
  const openFile = useContext(OpenFileContext)
  const spaceId = useContext(SpaceIdContext)
  const lazyLoad = useContext(LazyLoadContext)
  const taskRootSet = useContext(TaskFileTreeContext)
  const dimAllWorkspaceRoots = useContext(TaskDimAllWorkspaceRootsContext)
  const onboardingTree = useContext(OnboardingTreeContext)
  const taskActions = useContext(TaskActionsContext)
  const data = node.data
  const topSeg = data.relativePath.split(/[/\\]/).filter(Boolean)[0] ?? ''
  const isFolder = data.type === 'folder'
  const isTopLevel = isFolder && topSeg === data.name
  const isInTask = isTopLevel && !!taskActions?.projectDirs.has(data.name)
  const isLoading = lazyLoad?.loadingPaths.has(data.path) ?? false
  const dimmed = isDimmed(data.name)
  const canViewInCanvas = !isFolder && canOpenInCanvas(data.extension)

  // Handle folder toggle with lazy loading (must be before early return)
  const handleToggle = useCallback(async () => {
    if (!isFolder) return
    if (!node.isOpen && !data.childrenLoaded && lazyLoad) {
      await lazyLoad.loadChildren(data.path)
    }
    node.toggle()
  }, [isFolder, node, data.childrenLoaded, data.path, lazyLoad])

  // Handle click — select node and open in canvas, system app, or download
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Always select and focus the clicked node
    node.select()
    node.focus()
    
    if (isFolder) {
      handleToggle()
      return
    }

    if (canViewInCanvas && openFile) {
      void openFile(data.path, data.name, { openDefaultEditable: true })
      if (
        onboardingTree?.highlightFileName === data.name &&
        onboardingTree.onActivate
      ) {
        setTimeout(() => onboardingTree.onActivate?.(), 500)
      }
      return
    }

    if (isWebMode) {
      api.downloadArtifact(data.path)
    } else {
      try {
        await api.openArtifact(data.path)
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
    if (
      !isFolder &&
      onboardingTree?.highlightFileName === data.name &&
      onboardingTree.onActivate
    ) {
      setTimeout(() => onboardingTree.onActivate?.(), 500)
    }
  }, [node, isFolder, handleToggle, canViewInCanvas, openFile, data.path, data.name, onboardingTree])

  // Handle double-click to force open with system app
  const handleDoubleClickFile = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder) {
      node.toggle()
      return
    }
    if (isWebMode) {
      api.downloadArtifact(data.path)
    } else {
      try {
        await api.openArtifact(data.path)
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
  }, [isFolder, node, data.path])

  const runGitAction = useCallback(
    async (action: 'status' | 'add' | 'pull' | 'push' | 'diff') => {
      const show = useNotificationStore.getState().show
      try {
        const res = await api.runArtifactGitCommand(spaceId, data.path, action)
        if (!res.success) {
          show({
            title: t('Git'),
            body: res.error ?? t('Command failed'),
            variant: 'error',
            duration: 8000,
          })
          return
        }
        const payload = res.data
        if (!payload) {
          show({
            title: t('Git'),
            body: t('Command failed'),
            variant: 'error',
            duration: 8000,
          })
          return
        }
        if (!payload.ok) {
          const body =
            [payload.stderr, payload.stdout, payload.error].filter(Boolean).join('\n').trim() ||
            t('Command failed')
          show({
            title: t('Git'),
            body: body.length > 6000 ? `${body.slice(0, 6000)}…` : body,
            variant: 'warning',
            duration: 12000,
          })
          return
        }
        const body = (payload.stdout || payload.stderr || t('Done')).trim()
        show({
          title: t('Git'),
          body: body.length > 6000 ? `${body.slice(0, 6000)}…` : body,
          variant: 'success',
          duration: 8000,
        })
      } catch (e) {
        show({
          title: t('Git'),
          body: (e as Error).message,
          variant: 'error',
          duration: 8000,
        })
      }
    },
    [spaceId, data.path, t]
  )

  // Check editing state (after all hooks)
  if (node.isEditing) {
    return <EditingNode node={node} style={style} dragHandle={dragHandle} tree={node.tree} />
  }

  const outOfTaskScope =
    dimAllWorkspaceRoots || !!(taskRootSet && topSeg && !taskRootSet.has(topSeg))

  // Generate context menu items
  const menuItems: ContextMenuItem[] = [
    // New File (only for folders)
    {
      label: t('New File'),
      icon: <FilePlus className="w-4 h-4" />,
      onClick: () => {
        if (!node.isOpen) node.open()
        node.tree.create({ type: 'leaf', parentId: node.id })
      },
      hidden: !isFolder
    },
    // New Folder (only for folders)
    {
      label: t('New Folder'),
      icon: <FolderPlus className="w-4 h-4" />,
      onClick: () => {
        if (!node.isOpen) node.open()
        node.tree.create({ type: 'internal', parentId: node.id })
      },
      hidden: !isFolder
    },
    // 添加到任务 / 从任务移除 (only for top-level folders when a task is active)
    {
      label: isInTask ? t('从任务移除') : t('添加到任务'),
      icon: <FolderInput className="w-4 h-4" />,
      hidden: !isTopLevel || !taskActions,
      onClick: () => {
        if (!taskActions) return
        if (isInTask) taskActions.removeDir(data.name)
        else taskActions.addDir(data.name)
      }
    },
    // Separator (only for folders)
    {
      label: '',
      separator: true,
      hidden: !isFolder
    },
    // Rename
    {
      label: t('Rename'),
      icon: <Edit3 className="w-4 h-4" />,
      onClick: () => node.edit()
    },
    // Delete
    {
      label: t('Delete'),
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => node.tree.delete(node.id)
    },
    // Separator
    { label: '', separator: true },
    // Copy relative path
    {
      label: t('Copy relative path'),
      icon: <Copy className="w-4 h-4" />,
      onClick: () => copyToClipboard(data.relativePath)
    },
    // Copy absolute path
    {
      label: t('Copy absolute path'),
      icon: <Copy className="w-4 h-4" />,
      onClick: () => copyToClipboard(data.path)
    },
    // Git (desktop — sub-actions in secondary menu)
    {
      label: t('Git'),
      icon: <GitBranch className="w-4 h-4" />,
      hidden: isWebMode,
      children: [
        { label: t('Status'), onClick: () => void runGitAction('status') },
        { label: t('Stage'), onClick: () => void runGitAction('add') },
        { label: t('Diff'), onClick: () => void runGitAction('diff') },
        { label: t('Pull'), onClick: () => void runGitAction('pull') },
      ],
    },
    // Show in Folder (only for desktop mode)
    {
      label: t('Show in Folder'),
      icon: <FolderOpen className="w-4 h-4" />,
      onClick: async () => {
        try {
          await api.showArtifactInFolder(data.path)
        } catch (error) {
          console.error('Failed to show in folder:', error)
        }
      },
      hidden: isWebMode
    }
  ]

  const onboardingAttr =
    !isFolder &&
    onboardingTree?.highlightFileName &&
    data.name === onboardingTree.highlightFileName
      ? 'artifact-card'
      : undefined

  return (
    <ContextMenu items={menuItems}>
      <div
        ref={dragHandle}
        data-onboarding={onboardingAttr}
        style={style}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/halo-artifact-relative-path', data.relativePath)
          e.dataTransfer.setData('text/plain', data.relativePath)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClickFile}
        className={`
          group flex items-center h-full pr-2 cursor-pointer select-none
          transition-colors duration-75
          ${node.isSelected ? 'bg-primary/15' : outOfTaskScope ? 'hover:bg-muted/50' : 'hover:bg-secondary/60'}
          ${outOfTaskScope ? 'opacity-45 text-muted-foreground bg-muted/15' : ''}
        `}
        title={canViewInCanvas
          ? t('Click to preview · double-click to open with system')
          : (isWebMode && !isFolder ? t('Click to download file') : data.path)
        }
      >
      {/* Expand/collapse arrow for folders (or loading spinner) */}
      <span
        className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          if (isFolder) handleToggle()
        }}
      >
        {isFolder ? (
          isLoading ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          ) : node.isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70" />
          )
        ) : null}
      </span>

      {/* File/folder icon */}
      <span className={`w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1.5 ${dimmed ? 'opacity-50' : ''}`}>
        <FileIcon
          extension={data.extension}
          isFolder={isFolder}
          isOpen={isFolder && node.isOpen}
          size={15}
        />
      </span>

      {/* File name */}
      <span className={`
        text-[13px] truncate flex-1
        ${isFolder ? 'font-medium' : ''}
        ${dimmed ? 'text-muted-foreground/50' : (isFolder ? 'text-foreground/90' : 'text-foreground/80')}
      `}>
        {data.name}
      </span>

      {/* Action icons — CSS-only visibility via group-hover, zero JS overhead */}
      {!isFolder && canViewInCanvas && (
        <Eye className="w-3 h-3 text-primary flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-75" />
      )}
      {!isFolder && !canViewInCanvas && isWebMode && (
        <Download className="w-3 h-3 text-primary flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-75" />
      )}
    </div>
    </ContextMenu>
  )
}
