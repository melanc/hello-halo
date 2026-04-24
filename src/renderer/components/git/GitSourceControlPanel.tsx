/**
 * Source control panel — branch, staged / changes lists, commit; file rows open Git diff in canvas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, GitBranch, ExternalLink } from 'lucide-react'
import { api } from '../../api'
import type { GitWorkspaceStatusData, GitWorkspaceFileRow } from '../../types/git-workspace'
import { useTranslation } from '../../i18n'
import { useNotificationStore } from '../../stores/notification.store'
import { useCanvasStore } from '../../stores/canvas.store'
import { GitBranchSwitchPanel } from './GitBranchSwitchPanel'

const isWebMode = api.isRemoteMode()

/** Join workspace root (absolute, platform separators) with a single top-level segment — no `path` import (Vite browser bundle). */
function joinWorkspaceSegment(workspaceRoot: string, segment: string): string {
  const base = workspaceRoot.replace(/[/\\]+$/, '')
  const sep = workspaceRoot.includes('\\') ? '\\' : '/'
  return `${base}${sep}${segment}`
}

type GitArtifactQuickAction = 'pull' | 'pull-rebase' | 'push'
type GitPullMode = 'merge' | 'rebase'

const toolbarBtnBase =
  'shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none'
const toolbarBtnIdle = `${toolbarBtnBase} border-border/60 bg-background/60 text-foreground/90 hover:bg-secondary hover:border-border`
const toolbarBtnActive = `${toolbarBtnBase} border-primary/50 bg-primary/10 text-primary`

function GitPullModePicker({
  t,
  radioGroupName,
  mode,
  onModeChange,
  onRun,
}: {
  t: (key: string) => string
  radioGroupName: string
  mode: GitPullMode
  onModeChange: (m: GitPullMode) => void
  onRun: () => void
}) {
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
      <label className="flex items-start gap-2 cursor-pointer text-[10px] text-foreground/90 leading-snug">
        <input
          type="radio"
          name={radioGroupName}
          className="mt-0.5 shrink-0"
          checked={mode === 'merge'}
          onChange={() => onModeChange('merge')}
        />
        <span>{t('Merge remote into current local branch')}</span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer text-[10px] text-foreground/90 leading-snug">
        <input
          type="radio"
          name={radioGroupName}
          className="mt-0.5 shrink-0"
          checked={mode === 'rebase'}
          onChange={() => onModeChange('rebase')}
        />
        <span>{t('Rebase local commits onto remote branch')}</span>
      </label>
      <button
        type="button"
        onClick={onRun}
        className="w-full py-1 rounded-md text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {t('Run pull')}
      </button>
    </div>
  )
}

interface GitSourceControlPanelProps {
  spaceId: string
  /** Top-level folder names from the active task — each gets quick Git actions on its path */
  taskProjectDirNames?: string[]
}

export function GitSourceControlPanel({ spaceId, taskProjectDirNames }: GitSourceControlPanelProps) {
  const { t } = useTranslation()
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [dirBranches, setDirBranches] = useState<Record<string, string | null>>({})
  const [status, setStatus] = useState<GitWorkspaceStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [workspaceCommitPrepare, setWorkspaceCommitPrepare] = useState(false)
  const [workspaceSelectedUnstaged, setWorkspaceSelectedUnstaged] = useState<Set<string>>(new Set())
  const [workspaceDraftMsg, setWorkspaceDraftMsg] = useState('')
  const [workspaceAmendLast, setWorkspaceAmendLast] = useState(false)
  const [workspaceCommitting, setWorkspaceCommitting] = useState(false)
  const [workspaceDiscardPrepare, setWorkspaceDiscardPrepare] = useState(false)
  const [workspaceSelectedDiscard, setWorkspaceSelectedDiscard] = useState<Set<string>>(new Set())
  const [workspaceDiscarding, setWorkspaceDiscarding] = useState(false)
  const [workspaceBranchPanelOpen, setWorkspaceBranchPanelOpen] = useState(false)
  const [workspacePullPrepareOpen, setWorkspacePullPrepareOpen] = useState(false)
  const [workspacePullMode, setWorkspacePullMode] = useState<GitPullMode>('merge')
  const [banner, setBanner] = useState<string | null>(null)
  const [projectStatusByDir, setProjectStatusByDir] = useState<
    Record<string, GitWorkspaceStatusData>
  >({})
  const [projectStatusesLoading, setProjectStatusesLoading] = useState(false)

  const openGitDiffTab = useCanvasStore((s) => s.openGitDiffTab)

  const loadStatus = useCallback(async () => {
    if (!spaceId || isWebMode) return
    setLoading(true)
    setBanner(null)
    try {
      const res = await api.gitWorkspaceStatus(spaceId)
      if (res.success && res.data) {
        setStatus(res.data)
      } else {
        setStatus(null)
        setBanner(res.error || t('Could not load Git status'))
      }
    } catch (e) {
      setStatus(null)
      setBanner(e instanceof Error ? e.message : t('Could not load Git status'))
    } finally {
      setLoading(false)
    }
  }, [spaceId, t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (!spaceId || isWebMode) {
      setWorkspaceRoot(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const res = await api.listArtifactsTree(spaceId)
      if (cancelled) return
      const data = res.success && res.data ? (res.data as { workspaceRoot?: string }) : null
      const wr = data?.workspaceRoot && typeof data.workspaceRoot === 'string' ? data.workspaceRoot : null
      setWorkspaceRoot(wr)
    })()
    return () => {
      cancelled = true
    }
  }, [spaceId, isWebMode])

  const loadDirBranches = useCallback(async () => {
    if (!workspaceRoot || !taskProjectDirNames?.length) {
      setDirBranches({})
      return
    }
    const entries = await Promise.all(
      taskProjectDirNames.map(async (name) => {
        const abs = joinWorkspaceSegment(workspaceRoot, name)
        const res = await api.getGitBranchForPath(abs)
        const branch = res.success && res.data ? res.data.branch ?? null : null
        return [name, branch] as const
      })
    )
    setDirBranches(Object.fromEntries(entries))
  }, [workspaceRoot, taskProjectDirNames])

  useEffect(() => {
    void loadDirBranches()
  }, [loadDirBranches])

  const loadProjectStatuses = useCallback(async () => {
    if (!spaceId || isWebMode || !taskProjectDirNames?.length) {
      setProjectStatusByDir({})
      setProjectStatusesLoading(false)
      return
    }
    setProjectStatusesLoading(true)
    try {
      const entries = await Promise.all(
        taskProjectDirNames.map(async (name) => {
          const res = await api.gitProjectDirStatus(spaceId, name)
          const empty: GitWorkspaceStatusData = {
            isRepo: false,
            branch: null,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [],
          }
          const data =
            res.success && res.data ? (res.data as GitWorkspaceStatusData) : { ...empty, error: res.error }
          return [name, data] as const
        })
      )
      setProjectStatusByDir(Object.fromEntries(entries))
    } finally {
      setProjectStatusesLoading(false)
    }
  }, [spaceId, taskProjectDirNames])

  useEffect(() => {
    void loadProjectStatuses()
  }, [loadProjectStatuses])

  const runGitOnPath = useCallback(
    async (absPath: string, action: GitArtifactQuickAction): Promise<boolean> => {
      const show = useNotificationStore.getState().show
      try {
        const res = await api.runArtifactGitCommand(spaceId, absPath, action)
        if (!res.success) {
          show({
            title: t('Git'),
            body: res.error ?? t('Command failed'),
            variant: 'error',
            duration: 8000,
          })
          return false
        }
        const payload = res.data
        if (!payload) {
          show({
            title: t('Git'),
            body: t('Command failed'),
            variant: 'error',
            duration: 8000,
          })
          return false
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
          return false
        }
        const body = (payload.stdout || payload.stderr || t('Done')).trim()
        show({
          title: t('Git'),
          body: body.length > 6000 ? `${body.slice(0, 6000)}…` : body,
          variant: 'success',
          duration: 8000,
        })
        return true
      } catch (e) {
        show({
          title: t('Git'),
          body: (e as Error).message,
          variant: 'error',
          duration: 8000,
        })
        return false
      } finally {
        await loadDirBranches()
        await loadStatus()
        await loadProjectStatuses()
      }
    },
    [spaceId, t, loadDirBranches, loadStatus, loadProjectStatuses]
  )

  const refreshAll = useCallback(async () => {
    await loadStatus()
    await loadDirBranches()
    await loadProjectStatuses()
  }, [loadStatus, loadDirBranches, loadProjectStatuses])

  useEffect(() => {
    if (!spaceId || isWebMode) return
    let debounce: number | undefined
    const off = api.onArtifactChanged((event) => {
      if (event.spaceId !== spaceId) return
      if (debounce !== undefined) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        void loadStatus()
        void loadDirBranches()
        void loadProjectStatuses()
      }, 400)
    })
    return () => {
      off()
      if (debounce !== undefined) window.clearTimeout(debounce)
    }
  }, [spaceId, loadStatus, loadDirBranches, loadProjectStatuses])

  const openGitDiffInCanvas = useCallback(
    async (path: string, view: 'staged' | 'unstaged', projectTopLevel?: string) => {
      if (!spaceId) return
      setBanner(null)
      try {
        const res = projectTopLevel
          ? await api.gitProjectDirDiff(spaceId, projectTopLevel, path, view)
          : await api.gitWorkspaceDiff(spaceId, path, view)
        if (res.success && res.data) {
          const d = res.data
          await openGitDiffTab(d.fileName, d.oldString, d.newString, d.isBinary)
        } else {
          const msg = res.error || t('Could not load diff')
          setBanner(msg)
          useNotificationStore.getState().show({
            title: t('Git'),
            body: msg,
            variant: 'error',
            duration: 8000,
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : t('Could not load diff')
        setBanner(msg)
        useNotificationStore.getState().show({
          title: t('Git'),
          body: msg,
          variant: 'error',
          duration: 8000,
        })
      }
    },
    [spaceId, t, openGitDiffTab]
  )

  const onStageAll = async () => {
    if (!spaceId) return
    setBanner(null)
    const res = await api.gitWorkspaceStageAll(spaceId)
    if (!res.success) setBanner(res.error || t('Stage failed'))
    await loadStatus()
    await loadProjectStatuses()
  }

  const onUnstageAll = async () => {
    if (!spaceId) return
    setBanner(null)
    const res = await api.gitWorkspaceUnstageAll(spaceId)
    if (!res.success) setBanner(res.error || t('Unstage failed'))
    await loadStatus()
    await loadProjectStatuses()
  }

  const onProjectStageAll = useCallback(
    async (topLevel: string) => {
      if (!spaceId) return
      const st = projectStatusByDir[topLevel]
      if (!st?.isRepo || st.unstaged.length === 0) return
      setBanner(null)
      const res = await api.gitProjectDirStage(
        spaceId,
        topLevel,
        st.unstaged.map((r) => r.path)
      )
      if (!res.success) setBanner(res.error || t('Stage failed'))
      await loadStatus()
      await loadProjectStatuses()
    },
    [spaceId, t, projectStatusByDir, loadStatus, loadProjectStatuses]
  )

  const onProjectUnstageAll = useCallback(
    async (topLevel: string) => {
      if (!spaceId) return
      const st = projectStatusByDir[topLevel]
      if (!st?.isRepo || st.staged.length === 0) return
      setBanner(null)
      const res = await api.gitProjectDirUnstage(
        spaceId,
        topLevel,
        st.staged.map((r) => r.path)
      )
      if (!res.success) setBanner(res.error || t('Unstage failed'))
      await loadStatus()
      await loadProjectStatuses()
    },
    [spaceId, t, projectStatusByDir, loadStatus, loadProjectStatuses]
  )

  const workspaceUnstagedPaths = useMemo(
    () => (status?.unstaged ?? []).map((r) => r.path),
    [status?.unstaged]
  )
  const workspaceUnstagedFingerprint = workspaceUnstagedPaths.join('\0')

  useEffect(() => {
    if (!workspaceCommitPrepare || !status?.isRepo) return
    setWorkspaceSelectedUnstaged((prev) => {
      const next = new Set<string>()
      for (const p of workspaceUnstagedPaths) {
        if (prev.has(p)) next.add(p)
        else next.add(p)
      }
      return next
    })
  }, [workspaceCommitPrepare, workspaceUnstagedFingerprint, status?.isRepo])

  useEffect(() => {
    if (!workspaceDiscardPrepare || !status?.isRepo) return
    const valid = new Set(workspaceUnstagedPaths)
    setWorkspaceSelectedDiscard((prev) => new Set([...prev].filter((p) => valid.has(p))))
  }, [workspaceDiscardPrepare, workspaceUnstagedFingerprint, status?.isRepo, workspaceUnstagedPaths])

  const exitWorkspacePrepareModes = useCallback(() => {
    setWorkspaceCommitPrepare(false)
    setWorkspaceDiscardPrepare(false)
    setWorkspacePullPrepareOpen(false)
    setWorkspaceAmendLast(false)
    setWorkspaceDraftMsg('')
    setWorkspaceSelectedDiscard(new Set())
  }, [])

  const onWorkspaceDiscardFlow = async () => {
    if (!spaceId || workspaceSelectedDiscard.size === 0) return
    setWorkspaceDiscarding(true)
    setBanner(null)
    try {
      const res = await api.gitWorkspaceDiscardWorking(spaceId, [...workspaceSelectedDiscard])
      if (res.success) {
        exitWorkspacePrepareModes()
        await loadStatus()
        await loadProjectStatuses()
      } else {
        setBanner(res.error || t('Command failed'))
      }
    } finally {
      setWorkspaceDiscarding(false)
    }
  }

  const onWorkspaceCommitFlow = async () => {
    if (!spaceId || !status?.isRepo) return
    const canTry =
      workspaceAmendLast ||
      (Boolean(workspaceDraftMsg.trim()) &&
        (workspaceSelectedUnstaged.size > 0 || status.staged.length > 0))
    if (!canTry) return
    setWorkspaceCommitting(true)
    setBanner(null)
    try {
      const paths = [...workspaceSelectedUnstaged]
      if (paths.length > 0) {
        const stRes = await api.gitWorkspaceStage(spaceId, paths)
        if (!stRes.success) {
          setBanner(stRes.error || t('Stage failed'))
          return
        }
      }
      const res = await api.gitWorkspaceCommit(spaceId, workspaceDraftMsg, workspaceAmendLast)
      if (res.success) {
        setWorkspaceDraftMsg('')
        setWorkspaceAmendLast(false)
        setWorkspaceDiscardPrepare(false)
        setWorkspacePullPrepareOpen(false)
        setWorkspaceSelectedDiscard(new Set())
        await loadStatus()
        await loadProjectStatuses()
      } else {
        setBanner(res.error || t('Commit failed'))
      }
    } finally {
      setWorkspaceCommitting(false)
    }
  }

  const anyProjectRepo = useMemo(
    () => taskProjectDirNames?.some((n) => projectStatusByDir[n]?.isRepo) ?? false,
    [taskProjectDirNames, projectStatusByDir]
  )

  const firstProjectWithRepo = useMemo(
    () => taskProjectDirNames?.find((n) => projectStatusByDir[n]?.isRepo),
    [taskProjectDirNames, projectStatusByDir]
  )

  const headerBranchLabel = useMemo(() => {
    if (status?.isRepo) return status.branch || t('Detached')
    if (firstProjectWithRepo) {
      const b = projectStatusByDir[firstProjectWithRepo]?.branch
      return b || t('Detached')
    }
    return null
  }, [status, firstProjectWithRepo, projectStatusByDir, t])

  if (isWebMode) {
    return (
      <div className="flex-1 flex items-center justify-center px-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">{t('Source control requires the desktop app')}</p>
      </div>
    )
  }

  if (!spaceId) {
    return null
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-card/20">
      <div className="flex-shrink-0 flex flex-col gap-1.5 px-2 py-1.5 border-b border-border/50">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {status?.isRepo && (
              <button
                type="button"
                onClick={() => {
                  if (!workspaceBranchPanelOpen) exitWorkspacePrepareModes()
                  setWorkspaceBranchPanelOpen((v) => !v)
                }}
                className={workspaceBranchPanelOpen ? toolbarBtnActive : toolbarBtnIdle}
              >
                {t('Switch branch')}
              </button>
            )}
            {headerBranchLabel != null ? (
              <span className="text-[11px] font-medium text-foreground truncate px-2 py-0.5 rounded-md bg-secondary/60">
                {headerBranchLabel}
              </span>
            ) : (loading || projectStatusesLoading) && taskProjectDirNames?.length ? (
              <span className="text-[11px] text-muted-foreground truncate">{t('Loading...')}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground truncate">{t('No repository')}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {status?.isRepo && !isWebMode && (
              <button
                type="button"
                onClick={() => void api.gitOpenWindow({ spaceId, title: headerBranchLabel ?? 'Git' })}
                className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title={t('Open in window')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading || projectStatusesLoading}
              className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
              title={t('Refresh')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading || projectStatusesLoading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
        {status?.isRepo && workspaceBranchPanelOpen && (
          <GitBranchSwitchPanel
            spaceId={spaceId}
            onRefresh={refreshAll}
            onPushToRemote={() => {
              if (!workspaceRoot) return
              return runGitOnPath(workspaceRoot, 'push')
            }}
            pushToRemoteDisabled={!workspaceRoot}
          />
        )}
      </div>

      {banner && (
        <div className="flex-shrink-0 mx-2 mt-2 px-2 py-1.5 text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
          {banner}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {taskProjectDirNames && taskProjectDirNames.length > 0 && (
          <div className="border-b border-border/50 pb-2 mb-1">
            <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
              {t('Task project folders')}
            </div>
            {!workspaceRoot && (
              <p className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('Loading...')}</p>
            )}
            {workspaceRoot &&
              taskProjectDirNames.map((dirName) => (
                <TaskProjectGitDirBlock
                  key={dirName}
                  spaceId={spaceId}
                  dirName={dirName}
                  absPath={joinWorkspaceSegment(workspaceRoot, dirName)}
                  branchFallback={dirBranches[dirName]}
                  branchFallbackKnown={dirName in dirBranches}
                  projectStatus={projectStatusByDir[dirName]}
                  projectStatusesLoading={projectStatusesLoading}
                  onGitAction={runGitOnPath}
                  onOpenChangeGitDiff={(path) => void openGitDiffInCanvas(path, 'unstaged', dirName)}
                  onStageAll={() => void onProjectStageAll(dirName)}
                  onUnstageAll={() => void onProjectUnstageAll(dirName)}
                  onRefresh={refreshAll}
                />
              ))}
          </div>
        )}

        {!status?.isRepo && !loading && !projectStatusesLoading && !anyProjectRepo && (
          <p className="px-3 py-4 text-xs text-muted-foreground leading-relaxed">
            {status?.error || t('Open a folder that contains a Git repository to use source control.')}
          </p>
        )}

        {status?.isRepo && (
          <div className="pb-2">
            {taskProjectDirNames && taskProjectDirNames.length > 0 && (
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                {t('Full workspace')}
              </div>
            )}
            <SectionHeader
              title={t('Staged')}
              actionLabel={t('Unstage all')}
              onAction={status.staged.length ? onUnstageAll : undefined}
            />
            {status.staged.length === 0 ? (
              <p className="px-3 py-1 text-[10px] text-muted-foreground/70">{t('No staged changes')}</p>
            ) : (
              status.staged.map((row) => (
                <FileRow key={`s-${row.path}`} row={row} />
              ))
            )}

            <SectionHeader
              title={t('Changes')}
              actionLabel={t('Stage all')}
              onAction={status.unstaged.length ? onStageAll : undefined}
            />
            <div className="px-2 pb-1 flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1 items-center">
                <button
                  type="button"
                  disabled={!workspaceRoot}
                  onClick={() => {
                    if (workspacePullPrepareOpen) {
                      setWorkspacePullPrepareOpen(false)
                      return
                    }
                    setWorkspaceBranchPanelOpen(false)
                    setWorkspaceCommitPrepare(false)
                    setWorkspaceDiscardPrepare(false)
                    setWorkspaceAmendLast(false)
                    setWorkspaceDraftMsg('')
                    setWorkspaceSelectedDiscard(new Set())
                    setWorkspacePullMode('merge')
                    setWorkspacePullPrepareOpen(true)
                  }}
                  className={workspacePullPrepareOpen ? toolbarBtnActive : toolbarBtnIdle}
                  title={t('Pull')}
                >
                  {t('Pull')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (workspaceCommitPrepare) {
                      exitWorkspacePrepareModes()
                      return
                    }
                    setWorkspaceBranchPanelOpen(false)
                    setWorkspacePullPrepareOpen(false)
                    setWorkspaceDiscardPrepare(false)
                    setWorkspaceSelectedDiscard(new Set())
                    setWorkspaceCommitPrepare(true)
                  }}
                  className={workspaceCommitPrepare ? toolbarBtnActive : toolbarBtnIdle}
                  title={t('Prepare commit')}
                >
                  {t('Prepare commit')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (workspaceDiscardPrepare) {
                      exitWorkspacePrepareModes()
                      return
                    }
                    setWorkspaceBranchPanelOpen(false)
                    setWorkspacePullPrepareOpen(false)
                    setWorkspaceCommitPrepare(false)
                    setWorkspaceAmendLast(false)
                    setWorkspaceDraftMsg('')
                    setWorkspaceDiscardPrepare(true)
                    setWorkspaceSelectedDiscard(new Set())
                  }}
                  className={workspaceDiscardPrepare ? toolbarBtnActive : toolbarBtnIdle}
                  title={t('Discard (checkout)')}
                >
                  {t('Discard (checkout)')}
                </button>
              </div>
              {workspacePullPrepareOpen && workspaceRoot && (
                <GitPullModePicker
                  t={t}
                  radioGroupName="workspace-pull-mode"
                  mode={workspacePullMode}
                  onModeChange={setWorkspacePullMode}
                  onRun={() => {
                    void (async () => {
                      const action = workspacePullMode === 'rebase' ? 'pull-rebase' : 'pull'
                      const ok = await runGitOnPath(workspaceRoot, action)
                      if (ok) setWorkspacePullPrepareOpen(false)
                    })()
                  }}
                />
              )}
            </div>
            {status.unstaged.length === 0 ? (
              <p className="px-3 py-1 text-[10px] text-muted-foreground/70">{t('No changes')}</p>
            ) : (
              status.unstaged.map((row) => (
                <FileRow
                  key={`u-${row.path}`}
                  row={row}
                  onOpen={() => void openGitDiffInCanvas(row.path, 'unstaged')}
                  selection={
                    workspaceCommitPrepare
                      ? {
                          checked: workspaceSelectedUnstaged.has(row.path),
                          onChange: (next) =>
                            setWorkspaceSelectedUnstaged((prev) => {
                              const n = new Set(prev)
                              if (next) n.add(row.path)
                              else n.delete(row.path)
                              return n
                            }),
                          ariaLabel: t('Include in commit'),
                        }
                      : workspaceDiscardPrepare
                        ? {
                            checked: workspaceSelectedDiscard.has(row.path),
                            onChange: (next) =>
                              setWorkspaceSelectedDiscard((prev) => {
                                const n = new Set(prev)
                                if (next) n.add(row.path)
                                else n.delete(row.path)
                                return n
                              }),
                            ariaLabel: t('Select to discard'),
                          }
                        : undefined
                  }
                />
              ))
            )}
            {workspaceCommitPrepare && (
              <CommitPrepareBlock
                t={t}
                draftMessage={workspaceDraftMsg}
                onDraftMessageChange={setWorkspaceDraftMsg}
                amendLast={workspaceAmendLast}
                onAmendLastChange={setWorkspaceAmendLast}
                canCommit={
                  workspaceAmendLast ||
                  (Boolean(workspaceDraftMsg.trim()) &&
                    (workspaceSelectedUnstaged.size > 0 || status.staged.length > 0))
                }
                committing={workspaceCommitting}
                onCommit={() => void onWorkspaceCommitFlow()}
                onPush={() => {
                  if (workspaceRoot) void runGitOnPath(workspaceRoot, 'push')
                }}
                pushDisabled={!workspaceRoot}
              />
            )}
            {workspaceDiscardPrepare && (
              <DiscardWorkingFooter
                t={t}
                canDiscard={workspaceSelectedDiscard.size > 0}
                discarding={workspaceDiscarding}
                onDiscard={() => void onWorkspaceDiscardFlow()}
              />
            )}
          </div>
        )}
      </div>

    </div>
  )
}

function TaskProjectGitDirBlock({
  spaceId,
  dirName,
  absPath,
  branchFallback,
  branchFallbackKnown,
  projectStatus,
  projectStatusesLoading,
  onGitAction,
  onOpenChangeGitDiff,
  onStageAll,
  onUnstageAll,
  onRefresh,
}: {
  spaceId: string
  dirName: string
  absPath: string
  branchFallback: string | null | undefined
  branchFallbackKnown: boolean
  projectStatus: GitWorkspaceStatusData | undefined
  projectStatusesLoading: boolean
  onGitAction: (path: string, action: GitArtifactQuickAction) => Promise<boolean>
  /** Open Git diff in canvas — only used from Changes (unstaged) rows */
  onOpenChangeGitDiff: (path: string) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [commitPrepare, setCommitPrepare] = useState(false)
  const [selectedUnstaged, setSelectedUnstaged] = useState<Set<string>>(new Set())
  const [draftMessage, setDraftMessage] = useState('')
  const [amendLast, setAmendLast] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [discardPrepare, setDiscardPrepare] = useState(false)
  const [selectedDiscard, setSelectedDiscard] = useState<Set<string>>(new Set())
  const [discarding, setDiscarding] = useState(false)
  const [branchSwitchOpen, setBranchSwitchOpen] = useState(false)
  const [pullPrepareOpen, setPullPrepareOpen] = useState(false)
  const [pullMode, setPullMode] = useState<GitPullMode>('merge')
  const [bannerLocal, setBannerLocal] = useState<string | null>(null)

  const branchText =
    projectStatus !== undefined
      ? projectStatus.isRepo
        ? projectStatus.branch || t('Detached')
        : t('No repository')
      : branchFallbackKnown
        ? branchFallback ?? t('No repository')
        : t('Loading...')
  const showLists = projectStatus?.isRepo
  const listLoading = projectStatusesLoading && projectStatus === undefined

  const unstagedPaths = useMemo(
    () => (projectStatus?.unstaged ?? []).map((r) => r.path),
    [projectStatus?.unstaged]
  )
  const unstagedFingerprint = unstagedPaths.join('\0')

  useEffect(() => {
    if (!commitPrepare || !projectStatus?.isRepo) return
    setSelectedUnstaged((prev) => {
      const next = new Set<string>()
      for (const p of unstagedPaths) {
        if (prev.has(p)) next.add(p)
        else next.add(p)
      }
      return next
    })
  }, [commitPrepare, unstagedFingerprint, projectStatus?.isRepo])

  useEffect(() => {
    if (!discardPrepare || !projectStatus?.isRepo) return
    const valid = new Set(unstagedPaths)
    setSelectedDiscard((prev) => new Set([...prev].filter((p) => valid.has(p))))
  }, [discardPrepare, unstagedFingerprint, projectStatus?.isRepo, unstagedPaths])

  const exitProjectPrepareModes = useCallback(() => {
    setCommitPrepare(false)
    setDiscardPrepare(false)
    setBranchSwitchOpen(false)
    setPullPrepareOpen(false)
    setAmendLast(false)
    setDraftMessage('')
    setSelectedDiscard(new Set())
    setBannerLocal(null)
  }, [])

  const onProjectDiscardFlow = async () => {
    if (!projectStatus?.isRepo || selectedDiscard.size === 0) return
    setDiscarding(true)
    setBannerLocal(null)
    try {
      const res = await api.gitProjectDirDiscardWorking(spaceId, dirName, [...selectedDiscard])
      if (res.success) {
        exitProjectPrepareModes()
        await onRefresh()
      } else {
        setBannerLocal(res.error || t('Command failed'))
      }
    } finally {
      setDiscarding(false)
    }
  }

  const onProjectCommitFlow = async () => {
    if (!projectStatus?.isRepo) return
    const canTry =
      amendLast ||
      (Boolean(draftMessage.trim()) &&
        (selectedUnstaged.size > 0 || projectStatus.staged.length > 0))
    if (!canTry) return
    setCommitting(true)
    setBannerLocal(null)
    try {
      const paths = [...selectedUnstaged]
      if (paths.length > 0) {
        const stRes = await api.gitProjectDirStage(spaceId, dirName, paths)
        if (!stRes.success) {
          setBannerLocal(stRes.error || t('Stage failed'))
          return
        }
      }
      const res = await api.gitProjectDirCommit(spaceId, dirName, draftMessage, amendLast)
      if (res.success) {
        setDraftMessage('')
        setAmendLast(false)
        setDiscardPrepare(false)
        setPullPrepareOpen(false)
        setSelectedDiscard(new Set())
        await onRefresh()
      } else {
        setBannerLocal(res.error || t('Commit failed'))
      }
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="mx-1 mb-1.5 rounded-lg border border-border/50 overflow-hidden">
      <div className="flex items-center justify-between gap-1 min-w-0 px-2.5 py-1.5 bg-muted border-b border-border">
        <span className="text-[11px] font-mono font-medium text-foreground truncate" title={absPath}>
          {dirName}/
        </span>
        <span className="text-[9px] text-muted-foreground shrink-0 truncate max-w-[100px]" title={branchText}>
          {branchText}
        </span>
      </div>
      <div className="bg-secondary/20 px-2 py-1.5">
      <div className="flex flex-col gap-1.5 mb-1">
        <div className="flex flex-wrap gap-1">
          {showLists && (
            <button
              type="button"
              onClick={() => {
                if (!branchSwitchOpen) exitProjectPrepareModes()
                setBranchSwitchOpen((v) => !v)
              }}
              className={branchSwitchOpen ? toolbarBtnActive : toolbarBtnIdle}
              title={t('Switch branch')}
            >
              {t('Switch branch')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (pullPrepareOpen) {
                setPullPrepareOpen(false)
                return
              }
              setBranchSwitchOpen(false)
              setCommitPrepare(false)
              setDiscardPrepare(false)
              setAmendLast(false)
              setDraftMessage('')
              setSelectedDiscard(new Set())
              setPullMode('merge')
              setPullPrepareOpen(true)
            }}
            className={pullPrepareOpen ? toolbarBtnActive : toolbarBtnIdle}
            title={t('Pull')}
          >
            {t('Pull')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (commitPrepare) {
                exitProjectPrepareModes()
                return
              }
              setBranchSwitchOpen(false)
              setPullPrepareOpen(false)
              setDiscardPrepare(false)
              setSelectedDiscard(new Set())
              setCommitPrepare(true)
            }}
            className={commitPrepare ? toolbarBtnActive : toolbarBtnIdle}
            title={t('Prepare commit')}
          >
            {t('Prepare commit')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (discardPrepare) {
                exitProjectPrepareModes()
                return
              }
              setBranchSwitchOpen(false)
              setPullPrepareOpen(false)
              setCommitPrepare(false)
              setAmendLast(false)
              setDraftMessage('')
              setDiscardPrepare(true)
              setSelectedDiscard(new Set())
            }}
            className={discardPrepare ? toolbarBtnActive : toolbarBtnIdle}
            title={t('Discard (checkout)')}
          >
            {t('Discard (checkout)')}
          </button>
        </div>
        {pullPrepareOpen && (
          <GitPullModePicker
            t={t}
            radioGroupName={`task-pull-mode-${dirName}`}
            mode={pullMode}
            onModeChange={setPullMode}
            onRun={() => {
              void (async () => {
                const action = pullMode === 'rebase' ? 'pull-rebase' : 'pull'
                const ok = await onGitAction(absPath, action)
                if (ok) setPullPrepareOpen(false)
              })()
            }}
          />
        )}
      </div>
      {bannerLocal && (
        <p className="text-[10px] text-destructive mb-1 px-0.5">{bannerLocal}</p>
      )}
      {branchSwitchOpen && showLists && (
        <GitBranchSwitchPanel
          spaceId={spaceId}
          projectTopLevel={dirName}
          onRefresh={onRefresh}
          onPushToRemote={() => onGitAction(absPath, 'push')}
        />
      )}
      {listLoading && (
        <p className="text-[10px] text-muted-foreground/80 py-0.5">{t('Loading...')}</p>
      )}
      {showLists && (
        <div className="mt-1 border-t border-border/40 pt-1">
          <SectionHeader
            title={t('Staged')}
            actionLabel={t('Unstage all')}
            onAction={projectStatus.staged.length ? onUnstageAll : undefined}
          />
          {projectStatus.staged.length === 0 ? (
            <p className="px-1 py-0.5 text-[10px] text-muted-foreground/70">{t('No staged changes')}</p>
          ) : (
            projectStatus.staged.map((row) => (
              <FileRow key={`ps-${dirName}-s-${row.path}`} row={row} />
            ))
          )}
          <SectionHeader
            title={t('Changes')}
            actionLabel={t('Stage all')}
            onAction={projectStatus.unstaged.length ? onStageAll : undefined}
          />
          {projectStatus.unstaged.length === 0 ? (
            <p className="px-1 py-0.5 text-[10px] text-muted-foreground/70">{t('No changes')}</p>
          ) : (
            projectStatus.unstaged.map((row) => (
              <FileRow
                key={`ps-${dirName}-u-${row.path}`}
                row={row}
                onOpen={() => onOpenChangeGitDiff(row.path)}
                selection={
                  commitPrepare
                    ? {
                        checked: selectedUnstaged.has(row.path),
                        onChange: (next) =>
                          setSelectedUnstaged((prev) => {
                            const n = new Set(prev)
                            if (next) n.add(row.path)
                            else n.delete(row.path)
                            return n
                          }),
                        ariaLabel: t('Include in commit'),
                      }
                    : discardPrepare
                      ? {
                          checked: selectedDiscard.has(row.path),
                          onChange: (next) =>
                            setSelectedDiscard((prev) => {
                              const n = new Set(prev)
                              if (next) n.add(row.path)
                              else n.delete(row.path)
                              return n
                            }),
                          ariaLabel: t('Select to discard'),
                        }
                      : undefined
                }
              />
            ))
          )}
          {commitPrepare && (
            <CommitPrepareBlock
              t={t}
              draftMessage={draftMessage}
              onDraftMessageChange={setDraftMessage}
              amendLast={amendLast}
              onAmendLastChange={setAmendLast}
              canCommit={
                amendLast ||
                (Boolean(draftMessage.trim()) &&
                  (selectedUnstaged.size > 0 || (projectStatus?.staged.length ?? 0) > 0))
              }
              committing={committing}
              onCommit={() => void onProjectCommitFlow()}
              onPush={() => void onGitAction(absPath, 'push')}
              pushDisabled={false}
            />
          )}
          {discardPrepare && (
            <DiscardWorkingFooter
              t={t}
              canDiscard={selectedDiscard.size > 0}
              discarding={discarding}
              onDiscard={() => void onProjectDiscardFlow()}
            />
          )}
        </div>
      )}
      </div>
    </div>
  )
}

function DiscardWorkingFooter({
  t,
  canDiscard,
  discarding,
  onDiscard,
}: {
  t: (key: string) => string
  canDiscard: boolean
  discarding: boolean
  onDiscard: () => void
}) {
  const enabled = canDiscard && !discarding
  return (
    <div className="mt-2 pt-2 border-t border-border/40">
      <button
        type="button"
        disabled={!enabled}
        onClick={onDiscard}
        className={
          enabled
            ? 'w-full py-1.5 rounded-lg text-[11px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors'
            : 'w-full py-1.5 rounded-lg text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 cursor-not-allowed opacity-70'
        }
      >
        {discarding ? t('Discarding…') : t('Discard selected changes')}
      </button>
    </div>
  )
}

function CommitPrepareBlock({
  t,
  draftMessage,
  onDraftMessageChange,
  amendLast,
  onAmendLastChange,
  canCommit,
  committing,
  onCommit,
  onPush,
  pushDisabled,
}: {
  t: (key: string) => string
  draftMessage: string
  onDraftMessageChange: (v: string) => void
  amendLast: boolean
  onAmendLastChange: (v: boolean) => void
  canCommit: boolean
  committing: boolean
  onCommit: () => void
  onPush: () => void
  pushDisabled: boolean
}) {
  return (
    <div className="mt-2 pt-2 space-y-2 border-t border-border/40">
      <div>
        <label className="block text-[10px] text-muted-foreground font-medium mb-0.5">{t('Commit message')}</label>
        <textarea
          value={draftMessage}
          onChange={(e) => onDraftMessageChange(e.target.value)}
          placeholder={t('Commit message')}
          rows={3}
          className="w-full resize-none rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          className="rounded border-border shrink-0"
          checked={amendLast}
          onChange={(e) => onAmendLastChange(e.target.checked)}
        />
        <span>{t('Amend last commit')}</span>
      </label>
      <p className="text-[10px] text-muted-foreground/80 leading-snug">
        {t('Commit saves to your local repository. Push uploads your branch to the remote.')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={committing || !canCommit}
          onClick={onCommit}
          className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {committing ? t('Committing…') : t('Commit (git)')}
        </button>
        <button
          type="button"
          disabled={pushDisabled || committing}
          onClick={onPush}
          className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium border border-border/60 bg-background/60 text-foreground/90 hover:bg-secondary hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          {t('Push')}
        </button>
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string
  actionLabel: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-2 pb-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">{title}</span>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="text-[10px] text-primary hover:underline"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function FileRow({
  row,
  onOpen,
  selection,
}: {
  row: GitWorkspaceFileRow
  onOpen?: () => void
  selection?: { checked: boolean; onChange: (next: boolean) => void; ariaLabel?: string }
}) {
  const { t } = useTranslation()
  const checkLabel = selection?.ariaLabel ?? t('Include in commit')

  const label = (
    <>
      <span className="text-[9px] font-mono text-muted-foreground w-4 shrink-0 tabular-nums">
        {row.indexStatus || row.workingStatus || '·'}
      </span>
      <span className="text-[11px] font-mono text-foreground/90 truncate">{row.path}</span>
    </>
  )

  if (onOpen) {
    return (
      <div className="group flex items-center gap-0.5 px-1 py-0.5 hover:bg-secondary/40 rounded-md mx-1">
        {selection && (
          <input
            type="checkbox"
            className="shrink-0 rounded border-border w-3.5 h-3.5"
            checked={selection.checked}
            onChange={(e) => selection.onChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            title={checkLabel}
            aria-label={checkLabel}
          />
        )}
        <button
          type="button"
          onClick={onOpen}
          title={t('Open git diff in canvas')}
          className="flex-1 min-w-0 text-left flex items-center gap-1.5 py-0.5"
        >
          {label}
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 px-1 py-0.5 mx-1 rounded-md cursor-default text-muted-foreground/90"
      title={row.path}
    >
      {selection && (
        <input
          type="checkbox"
          className="shrink-0 rounded border-border w-3.5 h-3.5"
          checked={selection.checked}
          onChange={(e) => selection.onChange(e.target.checked)}
          aria-label={checkLabel}
        />
      )}
      {label}
    </div>
  )
}
