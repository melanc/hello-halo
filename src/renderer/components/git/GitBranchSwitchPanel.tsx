/**
 * Local branch list, checkout, delete, and create — workspace or task project scope.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { GitBranchListData } from '../../types/git-workspace'
import { useTranslation } from '../../i18n'

export function GitBranchSwitchPanel({
  spaceId,
  projectTopLevel,
  onRefresh,
  onPushToRemote,
  pushToRemoteDisabled,
}: {
  spaceId: string
  /** When set, operate on the Git repo for this task project folder */
  projectTopLevel?: string
  onRefresh: () => Promise<void>
  /** `git push` for the same repo as this panel (workspace root or project folder) */
  onPushToRemote?: () => void | Promise<void>
  pushToRemoteDisabled?: boolean
}) {
  const { t } = useTranslation()
  const [list, setList] = useState<GitBranchListData | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBranches = useCallback(async () => {
    setListLoading(true)
    setError(null)
    try {
      const res = projectTopLevel
        ? await api.gitProjectDirBranchList(spaceId, projectTopLevel)
        : await api.gitWorkspaceBranchList(spaceId)
      if (res.success && res.data) {
        setList(res.data)
        const cur = res.data.current
        const branches = res.data.branches
        const pick =
          cur && branches.includes(cur) ? cur : branches[0] !== undefined ? branches[0] : ''
        setSelectedBranch(pick)
      } else {
        setList(null)
        setSelectedBranch('')
        setError(res.error || t('Command failed'))
      }
    } catch (e) {
      setList(null)
      setSelectedBranch('')
      setError(e instanceof Error ? e.message : t('Command failed'))
    } finally {
      setListLoading(false)
    }
  }, [spaceId, projectTopLevel, t])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches])

  const current = list?.current ?? null
  const canSwitchOrDelete = Boolean(selectedBranch && selectedBranch !== current)

  const doCheckout = async () => {
    if (!selectedBranch || !canSwitchOrDelete) return
    setBusy(true)
    setError(null)
    try {
      const res = projectTopLevel
        ? await api.gitProjectDirCheckoutBranch(spaceId, projectTopLevel, selectedBranch)
        : await api.gitWorkspaceCheckoutBranch(spaceId, selectedBranch)
      if (!res.success) {
        setError(res.error || t('Command failed'))
        return
      }
      await loadBranches()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!selectedBranch || !canSwitchOrDelete) return
    setBusy(true)
    setError(null)
    try {
      const res = projectTopLevel
        ? await api.gitProjectDirDeleteBranch(spaceId, projectTopLevel, selectedBranch, false)
        : await api.gitWorkspaceDeleteBranch(spaceId, selectedBranch, false)
      if (!res.success) {
        setError(res.error || t('Command failed'))
        return
      }
      await loadBranches()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async () => {
    const name = newBranchName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const res = projectTopLevel
        ? await api.gitProjectDirCreateBranch(spaceId, projectTopLevel, name)
        : await api.gitWorkspaceCreateBranch(spaceId, name)
      if (!res.success) {
        setError(res.error || t('Command failed'))
        return
      }
      setNewBranchName('')
      await loadBranches()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const doPushToRemote = async () => {
    if (!onPushToRemote) return
    setBusy(true)
    setError(null)
    try {
      await onPushToRemote()
      await loadBranches()
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 pt-2 space-y-2 border-t border-border/40">
      {error && <p className="text-[10px] text-destructive px-0.5">{error}</p>}
      {listLoading ? (
        <p className="text-[10px] text-muted-foreground">{t('Loading...')}</p>
      ) : (
        <>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-[11px] text-foreground"
            disabled={busy || !(list?.branches.length)}
          >
            {list?.branches.length ? (
              list.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {list.current === b ? ` (${t('current branch')})` : ''}
                </option>
              ))
            ) : (
              <option value="">{t('No branches')}</option>
            )}
          </select>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || !canSwitchOrDelete}
              onClick={() => void doCheckout()}
              className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {t('Switch branch')}
            </button>
            <button
              type="button"
              disabled={busy || !canSwitchOrDelete}
              onClick={() => void doDelete()}
              className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {t('Delete branch')}
            </button>
          </div>
          <div className="pt-1 space-y-1.5">
            <div className="text-[10px] text-muted-foreground font-medium">{t('Create branch')}</div>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={t('Branch name')}
              disabled={busy}
              className="w-full rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || !newBranchName.trim()}
                onClick={() => void doCreate()}
                className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium border border-border/60 bg-background/60 text-foreground/90 hover:bg-secondary hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {t('Create')}
              </button>
              {onPushToRemote ? (
                <button
                  type="button"
                  disabled={busy || pushToRemoteDisabled}
                  onClick={() => void doPushToRemote()}
                  className="flex-1 min-w-[72px] py-1.5 rounded-lg text-[11px] font-medium border border-border/60 bg-background/60 text-foreground/90 hover:bg-secondary hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {t('Push to remote')}
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
