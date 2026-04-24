/**
 * Standalone Git panel — SourceTree-style layout for the dedicated Git window.
 * Loaded by main.tsx when ?mode=git&spaceId=<id> is in the URL.
 *
 * Multi-tab: the "+" button in the tab bar opens a directory picker so the user
 * can open multiple git repos (workspace root + top-level subdirectories) as tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GitBranch, RefreshCw, ArrowDown, ArrowUp, Plus, X, FolderOpen, ChevronDown } from 'lucide-react'
import { createPatch } from 'diff'
import { api } from '../../api'
import type {
  GitWorkspaceStatusData,
  GitWorkspaceFileRow,
  GitWorkspaceDiffData,
  GitBranchListData,
} from '../../types/git-workspace'
import type { ArtifactTreeNode } from '../../types'
import { useTranslation } from '../../i18n'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseDiffLines(
  patch: string
): Array<{ text: string; type: 'add' | 'remove' | 'hunk' | 'context' }> {
  return patch
    .split('\n')
    .slice(4) // skip '--- a/file' / '+++ b/file' header lines
    .map((line) => {
      if (line.startsWith('+')) return { text: line, type: 'add' as const }
      if (line.startsWith('-')) return { text: line, type: 'remove' as const }
      if (line.startsWith('@@')) return { text: line, type: 'hunk' as const }
      return { text: line, type: 'context' as const }
    })
}

function makeId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RepoTab {
  id: string
  /**
   * null  = workspace root  → uses gitWorkspace* APIs
   * string = top-level dir name (single segment, no '/') → uses gitProjectDir* APIs
   * gitProjectDir* only accepts single-segment names (validated by safeTopLevelSegment
   * in the service layer), so only immediate children of the workspace root can be tabs.
   */
  topLevelDir: string | null
  label: string
}

interface TabGitState {
  status: GitWorkspaceStatusData | null
  branches: GitBranchListData | null
  loading: boolean
}

const emptyState = (): TabGitState => ({ status: null, branches: null, loading: false })

// ─── Component ─────────────────────────────────────────────────────────────────

export function GitWindowApp({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation()

  // Workspace metadata (resolved once)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [topDirs, setTopDirs] = useState<ArtifactTreeNode[]>([])

  // Tabs
  const [tabs, setTabs] = useState<RepoTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Per-tab cached git state
  const [tabStates, setTabStates] = useState<Record<string, TabGitState>>({})
  const cur = activeTabId ? (tabStates[activeTabId] ?? emptyState()) : emptyState()

  // Transient state — reset when switching tabs
  const [selectedFile, setSelectedFile] = useState<{
    row: GitWorkspaceFileRow
    view: 'staged' | 'unstaged'
  } | null>(null)
  const [diff, setDiff] = useState<GitWorkspaceDiffData | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [amendLast, setAmendLast] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchBusy, setNewBranchBusy] = useState(false)
  const [banner, setBanner] = useState<{ text: string; isError: boolean } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  // Directory picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // ── Init: resolve workspace root, populate topDirs, create first tab ───────
  useEffect(() => {
    if (!spaceId) return
    void (async () => {
      const res = await api.listArtifactsTree(spaceId)
      if (!res.success || !res.data) return
      const data = res.data as { workspaceRoot?: string; tree?: ArtifactTreeNode[] }
      const root = data.workspaceRoot ?? null
      setWorkspaceRoot(root)
      // Only depth-0 folders are valid for gitProjectDir* (single-segment paths)
      const dirs = (data.tree ?? []).filter(
        (n) => n.type === 'folder' && !n.relativePath.includes('/') && !n.relativePath.includes('\\')
      )
      setTopDirs(dirs)
      // Create the initial workspace-root tab
      const id = makeId()
      const label = root ? (root.split('/').pop() ?? t('Workspace')) : t('Workspace')
      setTabs([{ id, topLevelDir: null, label }])
      setActiveTabId(id)
    })()
  }, [spaceId, t])

  // ── Close picker when clicking outside ─────────────────────────────────────
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  // ── Load git state for a tab ────────────────────────────────────────────────
  const loadTabState = useCallback(
    async (tabId: string, topLevelDir: string | null) => {
      setTabStates((prev) => ({
        ...prev,
        [tabId]: { ...(prev[tabId] ?? emptyState()), loading: true },
      }))
      setBanner(null)
      try {
        const [statusRes, branchRes] =
          topLevelDir === null
            ? await Promise.all([
                api.gitWorkspaceStatus(spaceId),
                api.gitWorkspaceBranchList(spaceId),
              ])
            : await Promise.all([
                api.gitProjectDirStatus(spaceId, topLevelDir),
                api.gitProjectDirBranchList(spaceId, topLevelDir),
              ])
        setTabStates((prev) => ({
          ...prev,
          [tabId]: {
            loading: false,
            status:
              statusRes.success && statusRes.data
                ? (statusRes.data as GitWorkspaceStatusData)
                : null,
            branches:
              branchRes.success && branchRes.data
                ? (branchRes.data as GitBranchListData)
                : null,
          },
        }))
        if (!statusRes.success) {
          setBanner({ text: statusRes.error ?? t('Could not load Git status'), isError: true })
        }
      } catch {
        setTabStates((prev) => ({ ...prev, [tabId]: emptyState() }))
      }
    },
    [spaceId, t]
  )

  // ── Auto-load when active tab changes ───────────────────────────────────────
  useEffect(() => {
    if (!activeTab) return
    setSelectedFile(null)
    setDiff(null)
    setCommitMsg('')
    setAmendLast(false)
    setBanner(null)
    const existing = tabStates[activeTab.id]
    if (!existing || (!existing.status && !existing.loading)) {
      void loadTabState(activeTab.id, activeTab.topLevelDir)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id])

  const refreshActive = useCallback(() => {
    if (!activeTab) return
    void loadTabState(activeTab.id, activeTab.topLevelDir)
  }, [activeTab, loadTabState])

  // ── Tab management ──────────────────────────────────────────────────────────
  const openDirTab = useCallback(
    (topLevelDir: string | null, label: string) => {
      const existing = tabs.find((t) =>
        topLevelDir === null ? t.topLevelDir === null : t.topLevelDir === topLevelDir
      )
      if (existing) {
        setActiveTabId(existing.id)
        return
      }
      const id = makeId()
      setTabs((prev) => [...prev, { id, topLevelDir, label }])
      setActiveTabId(id)
    },
    [tabs]
  )

  const closeTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        const next = prev.filter((t) => t.id !== tabId)
        if (activeTabId === tabId && next.length > 0) {
          setActiveTabId(next[Math.max(0, idx - 1)].id)
        }
        return next
      })
      setTabStates((prev) => {
        const n = { ...prev }
        delete n[tabId]
        return n
      })
    },
    [activeTabId]
  )

  // ── Git operations (dispatch on topLevelDir null vs string) ─────────────────
  const openDiff = useCallback(
    async (row: GitWorkspaceFileRow, view: 'staged' | 'unstaged') => {
      if (!activeTab) return
      setSelectedFile({ row, view })
      setDiffLoading(true)
      setDiff(null)
      try {
        const res =
          activeTab.topLevelDir === null
            ? await api.gitWorkspaceDiff(spaceId, row.path, view)
            : await api.gitProjectDirDiff(spaceId, activeTab.topLevelDir, row.path, view)
        if (res.success && res.data) setDiff(res.data as GitWorkspaceDiffData)
      } finally {
        setDiffLoading(false)
      }
    },
    [spaceId, activeTab]
  )

  const runRemote = useCallback(
    async (action: 'pull' | 'pull-rebase' | 'push') => {
      if (!workspaceRoot || !activeTab) return
      const absPath =
        activeTab.topLevelDir ? `${workspaceRoot}/${activeTab.topLevelDir}` : workspaceRoot
      setActionBusy(true)
      setBanner(null)
      try {
        const res = await api.runArtifactGitCommand(spaceId, absPath, action)
        if (res.success && res.data?.ok) {
          const body = (res.data.stdout || res.data.stderr || t('Done')).trim()
          setBanner({ text: `✓ ${body.slice(0, 300)}`, isError: false })
        } else {
          const errText = res.data
            ? [res.data.stderr, res.data.stdout, res.data.error].filter(Boolean).join('\n').trim()
            : (res.error ?? t('Command failed'))
          setBanner({ text: errText.slice(0, 400), isError: true })
        }
        refreshActive()
      } finally {
        setActionBusy(false)
      }
    },
    [spaceId, workspaceRoot, activeTab, refreshActive, t]
  )

  const doStageAll = async () => {
    if (!activeTab) return
    setBanner(null)
    const paths = cur.status?.unstaged.map((r) => r.path) ?? []
    if (!paths.length) return
    const res =
      activeTab.topLevelDir === null
        ? await api.gitWorkspaceStageAll(spaceId)
        : await api.gitProjectDirStage(spaceId, activeTab.topLevelDir, paths)
    if (!res.success) setBanner({ text: res.error ?? t('Stage failed'), isError: true })
    refreshActive()
  }

  const doUnstageAll = async () => {
    if (!activeTab) return
    setBanner(null)
    const paths = cur.status?.staged.map((r) => r.path) ?? []
    if (!paths.length) return
    const res =
      activeTab.topLevelDir === null
        ? await api.gitWorkspaceUnstageAll(spaceId)
        : await api.gitProjectDirUnstage(spaceId, activeTab.topLevelDir, paths)
    if (!res.success) setBanner({ text: res.error ?? t('Unstage failed'), isError: true })
    refreshActive()
  }

  const doStageFile = async (row: GitWorkspaceFileRow) => {
    if (!activeTab) return
    setBanner(null)
    const res =
      activeTab.topLevelDir === null
        ? await api.gitWorkspaceStage(spaceId, [row.path])
        : await api.gitProjectDirStage(spaceId, activeTab.topLevelDir, [row.path])
    if (!res.success) setBanner({ text: res.error ?? t('Stage failed'), isError: true })
    refreshActive()
  }

  const doUnstageFile = async (row: GitWorkspaceFileRow) => {
    if (!activeTab) return
    setBanner(null)
    const res =
      activeTab.topLevelDir === null
        ? await api.gitWorkspaceUnstage(spaceId, [row.path])
        : await api.gitProjectDirUnstage(spaceId, activeTab.topLevelDir, [row.path])
    if (!res.success) setBanner({ text: res.error ?? t('Unstage failed'), isError: true })
    refreshActive()
  }

  const doCommit = async () => {
    if (!activeTab || (!commitMsg.trim() && !amendLast)) return
    setCommitting(true)
    setBanner(null)
    try {
      const res =
        activeTab.topLevelDir === null
          ? await api.gitWorkspaceCommit(spaceId, commitMsg, amendLast)
          : await api.gitProjectDirCommit(spaceId, activeTab.topLevelDir, commitMsg, amendLast)
      if (res.success) {
        setCommitMsg('')
        setAmendLast(false)
        refreshActive()
      } else {
        setBanner({ text: res.error ?? t('Commit failed'), isError: true })
      }
    } finally {
      setCommitting(false)
    }
  }

  const doCommitAndPush = async () => {
    if (!activeTab || (!commitMsg.trim() && !amendLast)) return
    setCommitting(true)
    setBanner(null)
    try {
      const res =
        activeTab.topLevelDir === null
          ? await api.gitWorkspaceCommit(spaceId, commitMsg, amendLast)
          : await api.gitProjectDirCommit(spaceId, activeTab.topLevelDir, commitMsg, amendLast)
      if (!res.success) {
        setBanner({ text: res.error ?? t('Commit failed'), isError: true })
        return
      }
      setCommitMsg('')
      setAmendLast(false)
      refreshActive()
      await runRemote('push')
    } finally {
      setCommitting(false)
    }
  }

  const doCheckout = async (branch: string) => {
    if (!activeTab) return
    setBanner(null)
    const res =
      activeTab.topLevelDir === null
        ? await api.gitWorkspaceCheckoutBranch(spaceId, branch)
        : await api.gitProjectDirCheckoutBranch(spaceId, activeTab.topLevelDir, branch)
    if (!res.success) setBanner({ text: res.error ?? t('Command failed'), isError: true })
    refreshActive()
  }

  const doCreateBranch = async () => {
    if (!activeTab || !newBranchName.trim()) return
    setNewBranchBusy(true)
    setBanner(null)
    try {
      const res =
        activeTab.topLevelDir === null
          ? await api.gitWorkspaceCreateBranch(spaceId, newBranchName.trim())
          : await api.gitProjectDirCreateBranch(spaceId, activeTab.topLevelDir, newBranchName.trim())
      if (res.success) {
        setNewBranchName('')
        refreshActive()
      } else {
        setBanner({ text: res.error ?? t('Command failed'), isError: true })
      }
    } finally {
      setNewBranchBusy(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const { status, branches, loading } = cur
  const isRepo = status?.isRepo ?? false
  const currentBranch = status?.branch ?? branches?.current ?? null
  const diffLines =
    diff && !diff.isBinary
      ? parseDiffLines(
          createPatch(diff.fileName, diff.oldString, diff.newString, '', '', { context: 5 })
        )
      : null

  // Set of topLevelDir keys already open (to grey them out in the picker)
  const openDirKeys = new Set(tabs.map((t) => t.topLevelDir ?? '__root__'))

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-stretch border-b border-border bg-card/50 shrink-0 overflow-x-auto">

        {/* Add-tab button + directory picker */}
        <div className="relative shrink-0 flex items-center" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            title={t('Open repository')}
            className="h-full flex items-center gap-1 px-2.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 border-r border-border/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Dropdown */}
          {pickerOpen && (
            <div className="absolute top-full left-0 z-50 mt-0.5 w-60 bg-popover border border-border rounded-lg shadow-lg py-1 overflow-y-auto max-h-64">
              {/* Workspace root */}
              <button
                type="button"
                disabled={openDirKeys.has('__root__')}
                onClick={() => {
                  const label = workspaceRoot
                    ? (workspaceRoot.split('/').pop() ?? t('Workspace'))
                    : t('Workspace')
                  openDirTab(null, label)
                  setPickerOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="truncate font-medium">
                  {workspaceRoot ? workspaceRoot.split('/').pop() : t('Workspace')}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                  {t('root')}
                </span>
              </button>

              {/* Subdirectories */}
              {topDirs.length > 0 && <div className="my-1 border-t border-border/30" />}
              {topDirs.map((dir) => (
                <button
                  key={dir.id}
                  type="button"
                  disabled={openDirKeys.has(dir.relativePath)}
                  onClick={() => {
                    openDirTab(dir.relativePath, dir.name)
                    setPickerOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="truncate">{dir.name}</span>
                </button>
              ))}

              {topDirs.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground/60">
                  {t('No subdirectories')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Tab buttons */}
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border/40 shrink-0 whitespace-nowrap transition-colors ${
              tab.id === activeTabId
                ? 'bg-background text-foreground border-b-2 border-b-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <GitBranch className="w-3 h-3 shrink-0 opacity-70" />
            <span className="max-w-[100px] truncate">{tab.label}</span>
            {tabs.length > 1 && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => closeTab(tab.id, e)}
                className="ml-0.5 opacity-40 hover:opacity-100 hover:text-destructive transition-opacity leading-none"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-card/60">
        <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">
          {currentBranch ?? t('No repository')}
        </span>
        {(status?.ahead ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">↑{status!.ahead}</span>
        )}
        {(status?.behind ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">↓{status!.behind}</span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            disabled={!isRepo || !workspaceRoot || actionBusy}
            onClick={() => void runRemote('pull')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border/60 bg-background/60 text-foreground/80 hover:bg-secondary hover:border-border disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            {t('Pull')}
          </button>
          <button
            disabled={!isRepo || !workspaceRoot || actionBusy}
            onClick={() => void runRemote('push')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border/60 bg-background/60 text-foreground/80 hover:bg-secondary hover:border-border disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            {t('Push')}
          </button>
          <button
            disabled={loading}
            onClick={refreshActive}
            className="p-1.5 rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 transition-colors"
            title={t('Refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Banner ──────────────────────────────────────────────────────────── */}
      {banner && (
        <div
          className={`shrink-0 mx-3 mt-2 px-3 py-1.5 text-xs rounded-lg border ${
            banner.isError
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-border/40 bg-secondary/50 text-foreground/80'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* ── Main body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: branch list + new branch */}
        <div className="w-40 shrink-0 flex flex-col border-r border-border overflow-y-auto bg-card/30">
          <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium shrink-0">
            {t('Branches')}
          </div>

          {!isRepo ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">{t('No repository')}</p>
          ) : (
            <div className="flex flex-col gap-px">
              {(branches?.branches ?? []).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => void doCheckout(b)}
                  disabled={b === currentBranch}
                  title={b}
                  className={`text-left px-2 py-0.5 text-xs font-mono truncate transition-colors ${
                    b === currentBranch
                      ? 'text-primary font-semibold bg-primary/5'
                      : 'text-foreground/80 hover:bg-secondary/60'
                  }`}
                >
                  {b === currentBranch ? '● ' : '  '}
                  {b}
                </button>
              ))}
            </div>
          )}

          {/* New branch — pinned to bottom */}
          <div className="mt-auto px-2 pb-3 flex flex-col gap-1 border-t border-border/40 pt-2 shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              {t('New branch')}
            </div>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doCreateBranch()
              }}
              placeholder={t('Branch name')}
              disabled={newBranchBusy}
              className="w-full rounded border border-border/60 bg-background/80 px-1.5 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              type="button"
              disabled={!newBranchName.trim() || newBranchBusy}
              onClick={() => void doCreateBranch()}
              className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-[11px] border border-border/60 bg-background/60 text-foreground/80 hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('Create')}
            </button>
          </div>
        </div>

        {/* Center: staged / changes / commit + diff */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!isRepo && !loading && (
              <p className="px-4 py-6 text-sm text-muted-foreground leading-relaxed">
                {status?.error ??
                  t('Open a folder that contains a Git repository to use source control.')}
              </p>
            )}

            {isRepo && (
              <>
                {/* Staged */}
                <div className="flex items-center justify-between px-3 pt-2 pb-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                    {t('Staged')} ({status?.staged.length ?? 0})
                  </span>
                  {(status?.staged.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => void doUnstageAll()}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {t('Unstage all')}
                    </button>
                  )}
                </div>
                {(status?.staged.length ?? 0) === 0 ? (
                  <p className="px-3 py-0.5 text-[10px] text-muted-foreground/60">
                    {t('No staged changes')}
                  </p>
                ) : (
                  status?.staged.map((row) => (
                    <FileRow
                      key={`s-${row.path}`}
                      row={row}
                      view="staged"
                      selected={
                        selectedFile?.row.path === row.path && selectedFile.view === 'staged'
                      }
                      onOpen={() => void openDiff(row, 'staged')}
                      actionLabel="−"
                      actionTitle={t('Unstage')}
                      onAction={() => void doUnstageFile(row)}
                    />
                  ))
                )}

                {/* Changes */}
                <div className="flex items-center justify-between px-3 pt-3 pb-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                    {t('Changes')} ({status?.unstaged.length ?? 0})
                  </span>
                  {(status?.unstaged.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => void doStageAll()}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {t('Stage all')}
                    </button>
                  )}
                </div>
                {(status?.unstaged.length ?? 0) === 0 ? (
                  <p className="px-3 py-0.5 text-[10px] text-muted-foreground/60">
                    {t('No changes')}
                  </p>
                ) : (
                  status?.unstaged.map((row) => (
                    <FileRow
                      key={`u-${row.path}`}
                      row={row}
                      view="unstaged"
                      selected={
                        selectedFile?.row.path === row.path && selectedFile.view === 'unstaged'
                      }
                      onOpen={() => void openDiff(row, 'unstaged')}
                      actionLabel="+"
                      actionTitle={t('Stage')}
                      onAction={() => void doUnstageFile(row)}
                    />
                  ))
                )}

                {/* Commit */}
                <div className="px-3 py-3 mt-2 border-t border-border/40">
                  <label className="block text-[10px] text-muted-foreground font-medium mb-1">
                    {t('Commit message')}
                  </label>
                  <textarea
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder={t('Commit message')}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <label className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={amendLast}
                      onChange={(e) => setAmendLast(e.target.checked)}
                    />
                    {t('Amend last commit')}
                  </label>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      type="button"
                      disabled={committing || (!commitMsg.trim() && !amendLast)}
                      onClick={() => void doCommit()}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      {committing ? t('Committing…') : t('Commit (git)')}
                    </button>
                    <button
                      type="button"
                      disabled={committing || (!commitMsg.trim() && !amendLast) || !workspaceRoot}
                      onClick={() => void doCommitAndPush()}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-medium border border-border/60 bg-background/60 text-foreground/90 hover:bg-secondary hover:border-border disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      {t('Commit & Push')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Inline diff viewer */}
          {selectedFile && (
            <div
              className="flex flex-col border-t border-border shrink-0"
              style={{ height: '40%' }}
            >
              <div className="flex items-center gap-2 px-3 py-1 bg-card/40 border-b border-border/50 shrink-0">
                <span className="text-[11px] font-mono text-foreground/80 truncate">
                  {selectedFile.row.path}
                </span>
                <span className="text-[9px] text-muted-foreground/50 shrink-0">
                  ({selectedFile.view === 'staged' ? t('staged') : t('unstaged')})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null)
                    setDiff(null)
                  }}
                  className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[11px] leading-5">
                {diffLoading && (
                  <p className="px-3 py-2 text-muted-foreground text-xs">{t('Loading...')}</p>
                )}
                {!diffLoading && diff?.isBinary && (
                  <p className="px-3 py-2 text-muted-foreground text-xs">{t('Binary file')}</p>
                )}
                {!diffLoading &&
                  diffLines?.map((line, i) => (
                    <div
                      key={i}
                      className={`px-3 whitespace-pre ${
                        line.type === 'add'
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : line.type === 'remove'
                            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : line.type === 'hunk'
                              ? 'bg-blue-500/5 text-blue-600 dark:text-blue-400'
                              : 'text-foreground/80'
                      }`}
                    >
                      {line.text || '\u00a0'}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── FileRow sub-component ──────────────────────────────────────────────────────

function FileRow({
  row,
  view,
  selected,
  onOpen,
  actionLabel,
  actionTitle,
  onAction,
}: {
  row: GitWorkspaceFileRow
  view: 'staged' | 'unstaged'
  selected: boolean
  onOpen: () => void
  actionLabel: string
  actionTitle: string
  onAction: () => void
}) {
  const statusChar =
    view === 'staged' ? row.indexStatus || '·' : row.workingStatus || '·'

  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 mx-1 rounded cursor-pointer group transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-secondary/40'
      }`}
      onClick={onOpen}
    >
      <span className="text-[9px] font-mono text-muted-foreground w-4 shrink-0 tabular-nums">
        {statusChar}
      </span>
      <span
        className="text-[11px] font-mono text-foreground/90 truncate flex-1"
        title={row.path}
      >
        {row.path}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-px rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all shrink-0"
        title={actionTitle}
      >
        {actionLabel}
      </button>
    </div>
  )
}
