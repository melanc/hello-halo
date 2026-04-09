/**
 * Git workspace operations for the Source Control panel (simple-git).
 * All paths are validated to stay inside the space workspace directory.
 */

import simpleGit, { type SimpleGit } from 'simple-git'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs'
import { dirname, join, sep } from 'path'
import { getArtifactWorkspaceRoot } from './artifact.service'

/** Single top-level workspace folder name (no separators, no `..`). */
export function safeTopLevelSegment(name: string): string | null {
  const t = name.trim()
  if (!t || t.includes('/') || t.includes('\\') || t === '.' || t === '..') return null
  if (t.split(/[/\\]/).some((p) => p === '..')) return null
  return t
}

export interface GitWorkspaceFileRow {
  /** Path relative to repository root (posix-style from git) */
  path: string
  /** Short status label e.g. M, A, D */
  indexStatus: string
  workingStatus: string
}

export interface GitWorkspaceStatusData {
  isRepo: boolean
  error?: string
  repoRoot?: string
  branch: string | null
  ahead: number
  behind: number
  staged: GitWorkspaceFileRow[]
  unstaged: GitWorkspaceFileRow[]
}

export interface GitWorkspaceDiffData {
  fileName: string
  oldString: string
  newString: string
  isBinary: boolean
}

async function resolveGit(
  spaceId: string
): Promise<{ git: SimpleGit; repoRoot: string; workspaceRoot: string } | null> {
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) {
    return null
  }

  const probe = simpleGit(workspaceRoot)
  let repoRoot: string
  try {
    repoRoot = (await probe.revparse(['--show-toplevel'])).trim()
  } catch {
    return null
  }
  if (!repoRoot) return null

  const wr = realpathSync(workspaceRoot)
  const rr = realpathSync(repoRoot)
  if (wr !== rr && !wr.startsWith(rr + sep)) {
    return null
  }

  return { git: simpleGit(rr), repoRoot: rr, workspaceRoot: wr }
}

function assertRepoPathInWorkspace(
  repoRoot: string,
  workspaceRoot: string,
  gitRelativePath: string
): void {
  const norm = gitRelativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!norm || norm.split('/').some((p) => p === '..')) {
    throw new Error('Invalid path')
  }
  const abs = join(repoRoot, ...norm.split('/'))
  const wrPrefix = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep
  let realTarget: string
  try {
    realTarget = existsSync(abs) ? realpathSync(abs) : realpathSync(dirname(abs))
  } catch {
    throw new Error('Invalid path')
  }
  if (realTarget !== workspaceRoot && !realTarget.startsWith(wrPrefix)) {
    throw new Error('Path outside workspace')
  }
}

function splitStatusRows(
  files: Array<{ path: string; index: string; working_dir: string }>
): { staged: GitWorkspaceFileRow[]; unstaged: GitWorkspaceFileRow[] } {
  const staged: GitWorkspaceFileRow[] = []
  const unstaged: GitWorkspaceFileRow[] = []

  for (const f of files) {
    const ix = f.index === ' ' ? '' : f.index
    const wd = f.working_dir === ' ' ? '' : f.working_dir
    const isStaged = ix !== '' && ix !== '?'
    const isUntracked = ix === '?' && wd === '?'
    const hasWorkingChange = wd !== '' && wd !== '?'

    if (isStaged) {
      staged.push({ path: f.path, indexStatus: ix, workingStatus: wd })
    }
    if (hasWorkingChange || isUntracked) {
      unstaged.push({ path: f.path, indexStatus: ix, workingStatus: wd })
    }
  }

  const uniq = (rows: GitWorkspaceFileRow[]) => {
    const seen = new Set<string>()
    return rows.filter((r) => {
      if (seen.has(r.path)) return false
      seen.add(r.path)
      return true
    })
  }

  return { staged: uniq(staged), unstaged: uniq(unstaged) }
}

function filterRowsInWorkspace(
  repoRoot: string,
  workspaceRoot: string,
  rows: GitWorkspaceFileRow[]
): GitWorkspaceFileRow[] {
  return rows.filter((r) => {
    try {
      assertRepoPathInWorkspace(repoRoot, workspaceRoot, r.path)
      return true
    } catch {
      return false
    }
  })
}

function pathUnderTopLevelFolder(gitPath: string, segment: string): boolean {
  const p = gitPath.replace(/\\/g, '/')
  const seg = segment.replace(/\\/g, '/')
  return p === seg || p.startsWith(`${seg}/`)
}

/**
 * Git repo rooted exactly at workspaceRoot/segment (workspace root itself is not a repo).
 */
async function resolveGitFromNestedProjectFolder(
  workspaceRoot: string,
  segment: string
): Promise<{ git: SimpleGit; repoRoot: string } | null> {
  const projectAbs = join(workspaceRoot, segment)
  if (!existsSync(projectAbs)) return null
  try {
    if (!lstatSync(projectAbs).isDirectory()) return null
  } catch {
    return null
  }

  const probe = simpleGit(projectAbs)
  let repoRoot: string
  try {
    repoRoot = (await probe.revparse(['--show-toplevel'])).trim()
  } catch {
    return null
  }
  if (!repoRoot) return null

  const wr = realpathSync(workspaceRoot)
  const rr = realpathSync(repoRoot)
  const pr = realpathSync(projectAbs)
  const wrPrefix = wr.endsWith(sep) ? wr : wr + sep
  if (rr !== wr && !rr.startsWith(wrPrefix)) return null
  if (rr !== pr) return null

  return { git: simpleGit(rr), repoRoot: rr }
}

/**
 * Git status for one task project folder: either paths under that folder in a workspace-wide repo,
 * or a standalone repo rooted at workspace/segment.
 */
export async function gitProjectDirStatus(
  spaceId: string,
  topLevelDir: string
): Promise<GitWorkspaceStatusData> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment) {
    return {
      isRepo: false,
      error: 'Invalid folder name',
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }

  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) {
    return {
      isRepo: false,
      error: 'Workspace not found',
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }

  const ctxWorkspace = await resolveGit(spaceId)
  if (ctxWorkspace) {
    const { git, repoRoot, workspaceRoot: wr } = ctxWorkspace
    try {
      const status = await git.status()
      const { staged, unstaged } = splitStatusRows(status.files)
      const inSegment = (r: GitWorkspaceFileRow) => pathUnderTopLevelFolder(r.path, segment)
      return {
        isRepo: true,
        repoRoot,
        branch: status.current,
        ahead: status.ahead,
        behind: status.behind,
        staged: filterRowsInWorkspace(repoRoot, wr, staged.filter(inSegment)),
        unstaged: filterRowsInWorkspace(repoRoot, wr, unstaged.filter(inSegment)),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Git status failed'
      return {
        isRepo: false,
        error: msg,
        branch: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
      }
    }
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) {
    return {
      isRepo: false,
      error: 'Not a Git repository',
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }

  const { git, repoRoot } = nested
  const wr = realpathSync(workspaceRoot)
  try {
    const status = await git.status()
    const { staged, unstaged } = splitStatusRows(status.files)
    return {
      isRepo: true,
      repoRoot,
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      staged: filterRowsInWorkspace(repoRoot, wr, staged),
      unstaged: filterRowsInWorkspace(repoRoot, wr, unstaged),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Git status failed'
    return {
      isRepo: false,
      error: msg,
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }
}

async function runGitDiff(
  git: SimpleGit,
  repoRoot: string,
  workspaceRoot: string,
  relativePath: string,
  view: 'staged' | 'unstaged'
): Promise<GitWorkspaceDiffData> {
  assertRepoPathInWorkspace(repoRoot, workspaceRoot, relativePath)

  const norm = relativePath.replace(/\\/g, '/')
  const fileName = norm.split('/').pop() || norm
  const abs = join(repoRoot, ...norm.split('/'))

  if (view === 'staged') {
    const oldString = await gitShowText(git, `HEAD:${norm}`)
    const newString = await gitShowText(git, `:${norm}`)
    return { fileName, oldString, newString, isBinary: isBinaryContent(oldString) || isBinaryContent(newString) }
  }

  const oldString = await gitShowText(git, `:${norm}`)
  let newString = ''
  try {
    if (existsSync(abs)) {
      const buf = readFileSync(abs)
      if (buf.includes(0)) {
        return { fileName, oldString: '', newString: '', isBinary: true }
      }
      newString = buf.toString('utf8')
    }
  } catch {
    newString = ''
  }
  return {
    fileName,
    oldString,
    newString,
    isBinary: isBinaryContent(oldString) || isBinaryContent(newString),
  }
}

export async function gitWorkspaceStatus(spaceId: string): Promise<GitWorkspaceStatusData> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) {
    return {
      isRepo: false,
      error: 'Not a Git repository',
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }

  const { git, repoRoot, workspaceRoot } = ctx
  try {
    const status = await git.status()
    const { staged, unstaged } = splitStatusRows(status.files)

    return {
      isRepo: true,
      repoRoot,
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      staged: filterRowsInWorkspace(repoRoot, workspaceRoot, staged),
      unstaged: filterRowsInWorkspace(repoRoot, workspaceRoot, unstaged),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Git status failed'
    return {
      isRepo: false,
      error: msg,
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    }
  }
}

async function gitShowText(git: SimpleGit, spec: string): Promise<string> {
  try {
    const out = await git.show([spec])
    return typeof out === 'string' ? out : ''
  } catch {
    return ''
  }
}

export async function gitWorkspaceDiff(
  spaceId: string,
  relativePath: string,
  view: 'staged' | 'unstaged'
): Promise<GitWorkspaceDiffData> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) {
    throw new Error('Not a Git repository')
  }
  const { git, repoRoot, workspaceRoot } = ctx
  return runGitDiff(git, repoRoot, workspaceRoot, relativePath, view)
}

export async function gitProjectDirDiff(
  spaceId: string,
  topLevelDir: string,
  relativePath: string,
  view: 'staged' | 'unstaged'
): Promise<GitWorkspaceDiffData> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment) {
    throw new Error('Invalid folder name')
  }
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) {
    throw new Error('Workspace not found')
  }

  const ctxW = await resolveGit(spaceId)
  if (ctxW) {
    const p = relativePath.replace(/\\/g, '/')
    if (!pathUnderTopLevelFolder(p, segment)) {
      throw new Error('Path not under project folder')
    }
    return runGitDiff(ctxW.git, ctxW.repoRoot, ctxW.workspaceRoot, relativePath, view)
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) {
    throw new Error('Not a Git repository')
  }
  return runGitDiff(nested.git, nested.repoRoot, realpathSync(workspaceRoot), relativePath, view)
}

function isBinaryContent(s: string): boolean {
  if (!s) return false
  return s.includes('\0')
}

export async function gitWorkspaceStage(spaceId: string, paths: string[]): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const { git, repoRoot, workspaceRoot } = ctx
  if (paths.length === 0) return
  for (const p of paths) {
    assertRepoPathInWorkspace(repoRoot, workspaceRoot, p)
  }
  await git.add(paths)
}

export async function gitWorkspaceStageAll(spaceId: string): Promise<void> {
  const status = await gitWorkspaceStatus(spaceId)
  if (!status.isRepo) throw new Error('Not a Git repository')
  if (status.unstaged.length === 0) return
  await gitWorkspaceStage(
    spaceId,
    status.unstaged.map((r) => r.path)
  )
}

export async function gitWorkspaceUnstage(spaceId: string, paths: string[]): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const { git, repoRoot, workspaceRoot } = ctx
  if (paths.length === 0) return
  for (const p of paths) {
    assertRepoPathInWorkspace(repoRoot, workspaceRoot, p)
  }
  await git.reset(['HEAD', '--', ...paths])
}

export async function gitWorkspaceUnstageAll(spaceId: string): Promise<void> {
  const status = await gitWorkspaceStatus(spaceId)
  if (!status.isRepo) throw new Error('Not a Git repository')
  if (status.staged.length === 0) return
  await gitWorkspaceUnstage(
    spaceId,
    status.staged.map((r) => r.path)
  )
}

export async function gitProjectDirStage(
  spaceId: string,
  topLevelDir: string,
  paths: string[]
): Promise<void> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment || paths.length === 0) return
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) throw new Error('Workspace not found')

  const ctxW = await resolveGit(spaceId)
  if (ctxW) {
    const { git, repoRoot, workspaceRoot: wr } = ctxW
    for (const p of paths) {
      const n = p.replace(/\\/g, '/')
      if (!pathUnderTopLevelFolder(n, segment)) throw new Error('Path not under project folder')
      assertRepoPathInWorkspace(repoRoot, wr, p)
    }
    await git.add(paths)
    return
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) throw new Error('Not a Git repository')
  const wr = realpathSync(workspaceRoot)
  for (const p of paths) {
    assertRepoPathInWorkspace(nested.repoRoot, wr, p)
  }
  await nested.git.add(paths)
}

export async function gitProjectDirUnstage(
  spaceId: string,
  topLevelDir: string,
  paths: string[]
): Promise<void> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment || paths.length === 0) return
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) throw new Error('Workspace not found')

  const ctxW = await resolveGit(spaceId)
  if (ctxW) {
    const { git, repoRoot, workspaceRoot: wr } = ctxW
    for (const p of paths) {
      const n = p.replace(/\\/g, '/')
      if (!pathUnderTopLevelFolder(n, segment)) throw new Error('Path not under project folder')
      assertRepoPathInWorkspace(repoRoot, wr, p)
    }
    await git.reset(['HEAD', '--', ...paths])
    return
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) throw new Error('Not a Git repository')
  const wr = realpathSync(workspaceRoot)
  for (const p of paths) {
    assertRepoPathInWorkspace(nested.repoRoot, wr, p)
  }
  await nested.git.reset(['HEAD', '--', ...paths])
}

export async function gitProjectDirStageAll(spaceId: string, topLevelDir: string): Promise<void> {
  const st = await gitProjectDirStatus(spaceId, topLevelDir)
  if (!st.isRepo || st.unstaged.length === 0) return
  await gitProjectDirStage(
    spaceId,
    topLevelDir,
    st.unstaged.map((r) => r.path)
  )
}

export async function gitProjectDirUnstageAll(spaceId: string, topLevelDir: string): Promise<void> {
  const st = await gitProjectDirStatus(spaceId, topLevelDir)
  if (!st.isRepo || st.staged.length === 0) return
  await gitProjectDirUnstage(
    spaceId,
    topLevelDir,
    st.staged.map((r) => r.path)
  )
}

async function runGitCommit(
  git: SimpleGit,
  pathsHere: string[],
  messageTrimmed: string,
  amend: boolean
): Promise<void> {
  if (!amend) {
    if (!messageTrimmed) throw new Error('Commit message is required')
    if (pathsHere.length === 0) throw new Error('No staged changes in this workspace')
    await git.commit(messageTrimmed, pathsHere)
    return
  }
  if (messageTrimmed) {
    await git.raw(['commit', '--amend', '-m', messageTrimmed])
  } else {
    await git.raw(['commit', '--amend', '--no-edit'])
  }
}

export async function gitWorkspaceCommit(
  spaceId: string,
  message: string,
  amend?: boolean
): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const { git, repoRoot, workspaceRoot } = ctx
  const trimmed = message.trim()
  const isAmend = !!amend
  if (!isAmend && !trimmed) throw new Error('Commit message is required')

  const status = await git.status()
  const { staged } = splitStatusRows(status.files)
  const pathsHere: string[] = []
  for (const r of staged) {
    try {
      assertRepoPathInWorkspace(repoRoot, workspaceRoot, r.path)
      pathsHere.push(r.path)
    } catch {
      /* skip paths outside workspace */
    }
  }

  await runGitCommit(git, pathsHere, trimmed, isAmend)
}

/** Commit staged paths scoped to a task project folder (after caller has staged). */
export async function gitProjectDirCommit(
  spaceId: string,
  topLevelDir: string,
  message: string,
  amend?: boolean
): Promise<void> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment) throw new Error('Invalid folder name')
  const trimmed = message.trim()
  const isAmend = !!amend
  if (!isAmend && !trimmed) throw new Error('Commit message is required')

  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) throw new Error('Workspace not found')

  const ctxW = await resolveGit(spaceId)
  if (ctxW) {
    const { git, repoRoot, workspaceRoot: wr } = ctxW
    const status = await git.status()
    const { staged } = splitStatusRows(status.files)
    const pathsHere: string[] = []
    for (const r of staged) {
      const n = r.path.replace(/\\/g, '/')
      if (!pathUnderTopLevelFolder(n, segment)) continue
      try {
        assertRepoPathInWorkspace(repoRoot, wr, r.path)
        pathsHere.push(r.path)
      } catch {
        /* skip */
      }
    }
    await runGitCommit(git, pathsHere, trimmed, isAmend)
    return
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) throw new Error('Not a Git repository')
  const wr = realpathSync(workspaceRoot)
  const status = await nested.git.status()
  const { staged } = splitStatusRows(status.files)
  const pathsHere: string[] = []
  for (const r of staged) {
    try {
      assertRepoPathInWorkspace(nested.repoRoot, wr, r.path)
      pathsHere.push(r.path)
    } catch {
      /* skip */
    }
  }
  await runGitCommit(nested.git, pathsHere, trimmed, isAmend)
}

function normGitPath(p: string): string {
  return p.replace(/\\/g, '/')
}

function isStatusFileUntracked(f: { index: string; working_dir: string }): boolean {
  const ix = f.index === ' ' ? '' : f.index
  const wd = f.working_dir === ' ' ? '' : f.working_dir
  return ix === '?' && wd === '?'
}

/**
 * Discard unstaged working-tree changes for the given paths (tracked: restore from index; untracked: git clean).
 */
async function discardWorkingPathsInRepo(
  git: SimpleGit,
  repoRoot: string,
  workspaceRoot: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return
  const status = await git.status()
  const files = status.files ?? []
  const byPath = new Map<string, (typeof files)[0]>()
  for (const f of files) {
    byPath.set(normGitPath(f.path), f)
  }
  const tracked: string[] = []
  const untracked: string[] = []
  for (const p of paths) {
    assertRepoPathInWorkspace(repoRoot, workspaceRoot, p)
    const f = byPath.get(normGitPath(p))
    if (!f) continue
    if (isStatusFileUntracked(f)) untracked.push(f.path)
    else tracked.push(f.path)
  }
  if (tracked.length > 0) {
    await git.raw(['restore', '--worktree', '--', ...tracked])
  }
  if (untracked.length > 0) {
    await git.raw(['clean', '-f', '-q', '-d', '--', ...untracked])
  }
}

export async function gitWorkspaceDiscardWorking(spaceId: string, paths: string[]): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  if (paths.length === 0) throw new Error('No paths to discard')
  const { git, repoRoot, workspaceRoot } = ctx
  await discardWorkingPathsInRepo(git, repoRoot, workspaceRoot, paths)
}

export async function gitProjectDirDiscardWorking(
  spaceId: string,
  topLevelDir: string,
  paths: string[]
): Promise<void> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment || paths.length === 0) throw new Error('Invalid request')
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) throw new Error('Workspace not found')

  const ctxW = await resolveGit(spaceId)
  if (ctxW) {
    const { git, repoRoot, workspaceRoot: wr } = ctxW
    for (const p of paths) {
      const n = p.replace(/\\/g, '/')
      if (!pathUnderTopLevelFolder(n, segment)) throw new Error('Path not under project folder')
      assertRepoPathInWorkspace(repoRoot, wr, p)
    }
    await discardWorkingPathsInRepo(git, repoRoot, wr, paths)
    return
  }

  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  if (!nested) throw new Error('Not a Git repository')
  const wr = realpathSync(workspaceRoot)
  for (const p of paths) {
    assertRepoPathInWorkspace(nested.repoRoot, wr, p)
  }
  await discardWorkingPathsInRepo(nested.git, nested.repoRoot, wr, paths)
}

export interface GitBranchListData {
  branches: string[]
  /** Current branch short name, or null if detached HEAD */
  current: string | null
}

function assertBranchName(name: string): string {
  const t = name.trim()
  if (!t) throw new Error('Branch name is required')
  if (t.startsWith('-')) throw new Error('Invalid branch name')
  if (t.includes('..')) throw new Error('Invalid branch name')
  return t
}

async function branchListFromGit(git: SimpleGit): Promise<GitBranchListData> {
  const out = await git.raw(['for-each-ref', 'refs/heads/', '--format=%(refname:short)'])
  const branches = out
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  let current: string | null = null
  try {
    const head = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (head && head !== 'HEAD') current = head
  } catch {
    current = null
  }
  return { branches, current }
}

export async function gitWorkspaceBranchList(spaceId: string): Promise<GitBranchListData> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) return { branches: [], current: null }
  return branchListFromGit(ctx.git)
}

export async function gitWorkspaceCheckoutBranch(spaceId: string, branch: string): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const b = assertBranchName(branch)
  await ctx.git.raw(['checkout', b])
}

export async function gitWorkspaceDeleteBranch(
  spaceId: string,
  branch: string,
  force?: boolean
): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const b = assertBranchName(branch)
  const { current } = await branchListFromGit(ctx.git)
  if (current === b) throw new Error('Cannot delete the current branch')
  await ctx.git.raw(['branch', force ? '-D' : '-d', b])
}

export async function gitWorkspaceCreateBranch(spaceId: string, name: string): Promise<void> {
  const ctx = await resolveGit(spaceId)
  if (!ctx) throw new Error('Not a Git repository')
  const b = assertBranchName(name)
  await ctx.git.raw(['checkout', '-b', b])
}

async function resolveGitForProjectDir(spaceId: string, topLevelDir: string): Promise<SimpleGit | null> {
  const segment = safeTopLevelSegment(topLevelDir)
  if (!segment) return null
  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) return null
  const ctxW = await resolveGit(spaceId)
  if (ctxW) return ctxW.git
  const nested = await resolveGitFromNestedProjectFolder(workspaceRoot, segment)
  return nested?.git ?? null
}

export async function gitProjectDirBranchList(
  spaceId: string,
  topLevelDir: string
): Promise<GitBranchListData> {
  const git = await resolveGitForProjectDir(spaceId, topLevelDir)
  if (!git) return { branches: [], current: null }
  return branchListFromGit(git)
}

export async function gitProjectDirCheckoutBranch(
  spaceId: string,
  topLevelDir: string,
  branch: string
): Promise<void> {
  const git = await resolveGitForProjectDir(spaceId, topLevelDir)
  if (!git) throw new Error('Not a Git repository')
  await git.raw(['checkout', assertBranchName(branch)])
}

export async function gitProjectDirDeleteBranch(
  spaceId: string,
  topLevelDir: string,
  branch: string,
  force?: boolean
): Promise<void> {
  const git = await resolveGitForProjectDir(spaceId, topLevelDir)
  if (!git) throw new Error('Not a Git repository')
  const b = assertBranchName(branch)
  const { current } = await branchListFromGit(git)
  if (current === b) throw new Error('Cannot delete the current branch')
  await git.raw(['branch', force ? '-D' : '-d', b])
}

export async function gitProjectDirCreateBranch(
  spaceId: string,
  topLevelDir: string,
  name: string
): Promise<void> {
  const git = await resolveGitForProjectDir(spaceId, topLevelDir)
  if (!git) throw new Error('Not a Git repository')
  await git.raw(['checkout', '-b', assertBranchName(name)])
}
