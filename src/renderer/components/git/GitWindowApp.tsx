/**
 * Standalone Git panel — SourceTree-style layout for the dedicated Git window.
 * Loaded by main.tsx when ?mode=git&spaceId=<id> is in the URL.
 */

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { createPatch } from 'diff'
import { api } from '../../api'
import type {
  GitWorkspaceStatusData,
  GitWorkspaceFileRow,
  GitWorkspaceDiffData,
  GitBranchListData,
} from '../../types/git-workspace'
import { useTranslation } from '../../i18n'

/** Parse a unified diff patch string into typed display lines. */
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

interface GitWindowAppProps {
  spaceId: string
}

export function GitWindowApp({ spaceId }: GitWindowAppProps) {
  const { t } = useTranslation()

  const [status, setStatus] = useState<GitWorkspaceStatusData | null>(null)
  const [branches, setBranches] = useState<GitBranchListData | null>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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

  // Resolve workspace root for pull/push
  useEffect(() => {
    if (!spaceId) return
    ;(async () => {
      const res = await api.listArtifactsTree(spaceId)
      const data =
        res.success && res.data ? (res.data as { workspaceRoot?: string }) : null
      setWorkspaceRoot(data?.workspaceRoot ?? null)
    })()
  }, [spaceId])

  const loadAll = useCallback(async () => {
    if (!spaceId) return
    setLoading(true)
    setBanner(null)
    try {
      const [statusRes, branchRes] = await Promise.all([
        api.gitWorkspaceStatus(spaceId),
        api.gitWorkspaceBranchList(spaceId),
      ])
      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data as GitWorkspaceStatusData)
      } else {
        setStatus(null)
        setBanner({ text: statusRes.error ?? t('Could not load Git status'), isError: true })
      }
      if (branchRes.success && branchRes.data) {
        setBranches(branchRes.data as GitBranchListData)
      } else {
        setBranches(null)
      }
    } finally {
      setLoading(false)
    }
  }, [spaceId, t])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const openDiff = useCallback(
    async (row: GitWorkspaceFileRow, view: 'staged' | 'unstaged') => {
      setSelectedFile({ row, view })
      setDiffLoading(true)
      setDiff(null)
      try {
        const res = await api.gitWorkspaceDiff(spaceId, row.path, view)
        if (res.success && res.data) {
          setDiff(res.data as GitWorkspaceDiffData)
        }
      } finally {
        setDiffLoading(false)
      }
    },
    [spaceId]
  )

  const runRemote = useCallback(
    async (action: 'pull' | 'pull-rebase' | 'push') => {
      if (!workspaceRoot) return
      setActionBusy(true)
      setBanner(null)
      try {
        const res = await api.runArtifactGitCommand(spaceId, workspaceRoot, action)
        if (res.success && res.data?.ok) {
          const body = (res.data.stdout || res.data.stderr || t('Done')).trim()
          setBanner({ text: `✓ ${body.slice(0, 300)}`, isError: false })
        } else {
          const errText = res.data
            ? [res.data.stderr, res.data.stdout, res.data.error].filter(Boolean).join('\n').trim()
            : (res.error ?? t('Command failed'))
          setBanner({ text: errText.slice(0, 400), isError: true })
        }
        await loadAll()
      } finally {
        setActionBusy(false)
      }
    },
    [spaceId, workspaceRoot, loadAll, t]
  )

  const doStageAll = async () => {
    setBanner(null)
    const res = await api.gitWorkspaceStageAll(spaceId)
    if (!res.success) setBanner({ text: res.error ?? t('Stage failed'), isError: true })
    await loadAll()
  }

  const doUnstageAll = async () => {
    setBanner(null)
    const res = await api.gitWorkspaceUnstageAll(spaceId)
    if (!res.success) setBanner({ text: res.error ?? t('Unstage failed'), isError: true })
    await loadAll()
  }

  const doStageFile = async (row: GitWorkspaceFileRow) => {
    setBanner(null)
    const res = await api.gitWorkspaceStage(spaceId, [row.path])
    if (!res.success) setBanner({ text: res.error ?? t('Stage failed'), isError: true })
    await loadAll()
  }

  const doUnstageFile = async (row: GitWorkspaceFileRow) => {
    setBanner(null)
    const res = await api.gitWorkspaceUnstage(spaceId, [row.path])
    if (!res.success) setBanner({ text: res.error ?? t('Unstage failed'), isError: true })
    await loadAll()
  }

  const doCommit = async () => {
    if (!commitMsg.trim() && !amendLast) return
    setCommitting(true)
    setBanner(null)
    try {
      const res = await api.gitWorkspaceCommit(spaceId, commitMsg, amendLast)
      if (res.success) {
        setCommitMsg('')
        setAmendLast(false)
        await loadAll()
      } else {
        setBanner({ text: res.error ?? t('Commit failed'), isError: true })
      }
    } finally {
      setCommitting(false)
    }
  }

  const doCommitAndPush = async () => {
    if (!commitMsg.trim() && !amendLast) return
    setCommitting(true)
    setBanner(null)
    try {
      const commitRes = await api.gitWorkspaceCommit(spaceId, commitMsg, amendLast)
      if (!commitRes.success) {
        setBanner({ text: commitRes.error ?? t('Commit failed'), isError: true })
        return
      }
      setCommitMsg('')
      setAmendLast(false)
      await loadAll()
      await runRemote('push')
    } finally {
      setCommitting(false)
    }
  }

  const doCheckout = async (branch: string) => {
    setBanner(null)
    const res = await api.gitWorkspaceCheckoutBranch(spaceId, branch)
    if (!res.success) setBanner({ text: res.error ?? t('Command failed'), isError: true })
    await loadAll()
  }

  const doCreateBranch = async () => {
    const name = newBranchName.trim()
    if (!name) return
    setNewBranchBusy(true)
    setBanner(null)
    try {
      const res = await api.gitWorkspaceCreateBranch(spaceId, name)
      if (res.success) {
        setNewBranchName('')
        await loadAll()
      } else {
        setBanner({ text: res.error ?? t('Command failed'), isError: true })
      }
    } finally {
      setNewBranchBusy(false)
    }
  }

  const isRepo = status?.isRepo ?? false
  const currentBranch = status?.branch ?? branches?.current ?? null
  const diffLines =
    diff && !diff.isBinary
      ? parseDiffLines(
          createPatch(diff.fileName, diff.oldString, diff.newString, '', '', { context: 5 })
        )
      : null

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-card/60">
        <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">
          {currentBranch ?? t('No repository')}
        </span>
        {status?.ahead ? (
          <span className="text-xs text-muted-foreground shrink-0">↑{status.ahead}</span>
        ) : null}
        {status?.behind ? (
          <span className="text-xs text-muted-foreground shrink-0">↓{status.behind}</span>
        ) : null}
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
            onClick={() => void loadAll()}
            className="p-1.5 rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 transition-colors"
            title={t('Refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Banner */}
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

      {/* Main body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: branch list */}
        <div className="w-40 shrink-0 flex flex-col border-r border-border overflow-y-auto bg-card/30">
          <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            {t('Branches')}
          </div>

          {!isRepo ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">{t('No repository')}</p>
          ) : (
            <div className="flex flex-col gap-px">
              {(branches?.branches ?? []).map((b) => (
                <button
                  key={b}
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

          {/* New branch input */}
          <div className="mt-3 px-2 pb-3 flex flex-col gap-1 border-t border-border/40 pt-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              {t('New branch')}
            </div>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doCreateBranch() }}
              placeholder={t('Branch name')}
              disabled={newBranchBusy}
              className="w-full rounded border border-border/60 bg-background/80 px-1.5 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              disabled={!newBranchName.trim() || newBranchBusy}
              onClick={() => void doCreateBranch()}
              className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-[11px] border border-border/60 bg-background/60 text-foreground/80 hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('Create')}
            </button>
          </div>
        </div>

        {/* Right: file list + commit + diff */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* File changes area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!isRepo && !loading && (
              <p className="px-4 py-6 text-sm text-muted-foreground leading-relaxed">
                {status?.error ?? t('Open a folder that contains a Git repository to use source control.')}
              </p>
            )}

            {isRepo && (
              <>
                {/* Staged section */}
                <div className="flex items-center justify-between px-3 pt-2 pb-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                    {t('Staged')} ({status?.staged.length ?? 0})
                  </span>
                  {(status?.staged.length ?? 0) > 0 && (
                    <button
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

                {/* Changes (unstaged) section */}
                <div className="flex items-center justify-between px-3 pt-3 pb-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                    {t('Changes')} ({status?.unstaged.length ?? 0})
                  </span>
                  {(status?.unstaged.length ?? 0) > 0 && (
                    <button
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
                      onAction={() => void doStageFile(row)}
                    />
                  ))
                )}

                {/* Commit area */}
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
                      disabled={committing || (!commitMsg.trim() && !amendLast)}
                      onClick={() => void doCommit()}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      {committing ? t('Committing…') : t('Commit (git)')}
                    </button>
                    <button
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
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[11px] leading-5">
                {diffLoading && (
                  <p className="px-3 py-2 text-muted-foreground text-xs">{t('Loading...')}</p>
                )}
                {!diffLoading && diff?.isBinary && (
                  <p className="px-3 py-2 text-muted-foreground text-xs">{t('Binary file')}</p>
                )}
                {!diffLoading && diffLines?.map((line, i) => (
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
    view === 'staged'
      ? row.indexStatus || '·'
      : row.workingStatus || '·'

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
      <span className="text-[11px] font-mono text-foreground/90 truncate flex-1" title={row.path}>
        {row.path}
      </span>
      <button
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
