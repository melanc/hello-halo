/**
 * Workspace text search and replace across files under a space working directory.
 * Skips heavy/binary dirs; respects workspace boundary (same root as artifacts).
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { getArtifactWorkspaceRoot } from './artifact.service'
import type {
  WorkspaceSearchMatch,
  WorkspaceSearchOptionsInput,
  WorkspaceSearchOptionsResolved,
  WorkspaceReplaceAllResult,
} from '../../shared/types/workspace-search'

const MAX_SCAN_FILES = 12_000
const DEFAULT_MAX_RESULTS = 2000
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const ABS_MAX_RESULTS = 10_000
const ABS_MAX_FILE_BYTES = 8 * 1024 * 1024

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  '.svn',
  '.hg',
  'target',
])

/** Hidden dirs we still search (tooling / CI). */
const ALLOW_DOT_DIRS = new Set(['.vscode', '.github'])

export function resolveWorkspaceSearchOptions(
  input?: WorkspaceSearchOptionsInput
): WorkspaceSearchOptionsResolved {
  const maxResults = Math.min(
    Math.max(1, input?.maxResults ?? DEFAULT_MAX_RESULTS),
    ABS_MAX_RESULTS
  )
  const maxFileBytes = Math.min(
    Math.max(1024, input?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
    ABS_MAX_FILE_BYTES
  )
  const roots = input?.relativeRoots?.map((r) => r.trim()).filter(Boolean)
  return {
    caseSensitive: !!input?.caseSensitive,
    wholeWord: !!input?.wholeWord,
    useRegex: !!input?.useRegex,
    maxResults,
    maxFileBytes,
    relativeRoots: roots?.length ? roots : undefined,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildWorkspaceSearchRegex(
  query: string,
  opts: Pick<WorkspaceSearchOptionsResolved, 'caseSensitive' | 'wholeWord' | 'useRegex'>
): RegExp | null {
  const q = query.trim()
  if (!q) return null
  try {
    if (opts.useRegex) {
      const flags = opts.caseSensitive ? 'g' : 'gi'
      return new RegExp(q, flags)
    }
    let pattern = escapeRegExp(q)
    if (opts.wholeWord) {
      pattern = `\\b${pattern}\\b`
    }
    const flags = opts.caseSensitive ? 'g' : 'gi'
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true
  if (name.startsWith('.') && !ALLOW_DOT_DIRS.has(name)) return true
  return false
}

function assertPathInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  if (!existsSync(targetPath)) {
    throw new Error('Path does not exist')
  }
  const realPath = realpathSync(targetPath)
  const realRoot = realpathSync(workspaceRoot)
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
  if (realPath !== realRoot && !realPath.startsWith(rootWithSep)) {
    throw new Error('Access denied: path is outside workspace')
  }
}

function collectFiles(absDir: string, workspaceRoot: string, out: string[], maxFiles: number): void {
  if (out.length >= maxFiles) return
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= maxFiles) return
    const full = join(absDir, e.name)
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name)) continue
      collectFiles(full, workspaceRoot, out, maxFiles)
    } else if (e.isFile()) {
      try {
        assertPathInsideWorkspace(workspaceRoot, full)
      } catch {
        continue
      }
      out.push(full)
    }
  }
}

function listSearchRoots(spaceId: string, workspaceRoot: string, relativeRoots?: string[]): string[] {
  if (!relativeRoots?.length) {
    return [workspaceRoot]
  }
  const roots: string[] = []
  for (const r of relativeRoots) {
    const joined = join(workspaceRoot, r)
    if (!existsSync(joined)) continue
    try {
      assertPathInsideWorkspace(workspaceRoot, joined)
    } catch {
      continue
    }
    const st = statSync(joined)
    if (st.isDirectory()) {
      roots.push(joined)
    }
  }
  return roots.length ? roots : [workspaceRoot]
}

function readUtf8TextFile(filePath: string, maxBytes: number): string | null {
  try {
    const st = statSync(filePath)
    if (!st.isFile() || st.size > maxBytes) return null
    const buf = readFileSync(filePath)
    const check = buf.subarray(0, Math.min(buf.length, 65536))
    if (check.includes(0)) return null
    return buf.toString('utf-8')
  } catch {
    return null
  }
}

function searchInText(
  content: string,
  re: RegExp,
  filePath: string,
  relPath: string,
  matches: WorkspaceSearchMatch[],
  maxResults: number
): void {
  const lines = content.split(/\r\n|\n|\r/)
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  for (let li = 0; li < lines.length; li++) {
    if (matches.length >= maxResults) return
    const line = lines[li]
    const lineRe = new RegExp(re.source, flags)
    let m: RegExpExecArray | null
    while ((m = lineRe.exec(line)) !== null) {
      matches.push({
        path: filePath,
        relativePath: relPath,
        line: li + 1,
        column: m.index + 1,
        length: m[0].length,
        preview: line,
      })
      if (matches.length >= maxResults) return
      if (m[0].length === 0) {
        lineRe.lastIndex++
        if (lineRe.lastIndex > line.length) break
      }
    }
  }
}

export function searchWorkspaceFiles(
  spaceId: string,
  query: string,
  optionsInput?: WorkspaceSearchOptionsInput
): { ok: true; matches: WorkspaceSearchMatch[] } | { ok: false; error: string } {
  const opts = resolveWorkspaceSearchOptions(optionsInput)
  const re = buildWorkspaceSearchRegex(query, opts)
  if (!re) {
    return query.trim() ? { ok: false, error: 'Invalid search pattern' } : { ok: true, matches: [] }
  }

  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) {
    return { ok: true, matches: [] }
  }

  const roots = listSearchRoots(spaceId, workspaceRoot, opts.relativeRoots)
  const files: string[] = []
  for (const root of roots) {
    collectFiles(root, workspaceRoot, files, MAX_SCAN_FILES)
    if (files.length >= MAX_SCAN_FILES) break
  }

  const matches: WorkspaceSearchMatch[] = []
  for (const filePath of files) {
    if (matches.length >= opts.maxResults) break
    const text = readUtf8TextFile(filePath, opts.maxFileBytes)
    if (text == null) continue
    let relPath: string
    try {
      relPath = relative(workspaceRoot, filePath).replace(/\\/g, '/')
    } catch {
      relPath = filePath
    }
    searchInText(text, re, filePath, relPath, matches, opts.maxResults)
  }

  return { ok: true, matches }
}

export function replaceAllInWorkspaceFiles(
  spaceId: string,
  find: string,
  replace: string,
  optionsInput?: WorkspaceSearchOptionsInput
): { ok: true; result: WorkspaceReplaceAllResult } | { ok: false; error: string } {
  const opts = resolveWorkspaceSearchOptions(optionsInput)
  const re = buildWorkspaceSearchRegex(find, opts)
  if (!re) {
    return find.trim() ? { ok: false, error: 'Invalid search pattern' } : { ok: false, error: 'Empty find pattern' }
  }

  const workspaceRoot = getArtifactWorkspaceRoot(spaceId)
  if (!existsSync(workspaceRoot)) {
    return { ok: true, result: { replacedFiles: 0, replacedOccurrences: 0, errors: [] } }
  }

  const roots = listSearchRoots(spaceId, workspaceRoot, opts.relativeRoots)
  const files: string[] = []
  for (const root of roots) {
    collectFiles(root, workspaceRoot, files, MAX_SCAN_FILES)
    if (files.length >= MAX_SCAN_FILES) break
  }

  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`

  let replacedFiles = 0
  let replacedOccurrences = 0
  const errors: string[] = []

  for (const filePath of files) {
    const text = readUtf8TextFile(filePath, opts.maxFileBytes)
    if (text == null) continue

    const countRe = new RegExp(re.source, flags)
    let count = 0
    let m: RegExpExecArray | null
    while ((m = countRe.exec(text)) !== null) {
      count++
      if (m[0].length === 0) {
        countRe.lastIndex++
        if (countRe.lastIndex > text.length) break
      }
    }
    if (count === 0) continue

    const replaceRe = new RegExp(re.source, flags)
    const newContent = text.replace(replaceRe, () => replace)
    if (newContent === text) continue

    try {
      assertPathInsideWorkspace(workspaceRoot, filePath)
      writeFileSync(filePath, newContent, 'utf-8')
      replacedFiles++
      replacedOccurrences += count
    } catch (e) {
      errors.push(`${filePath}: ${(e as Error).message}`)
    }
  }

  return { ok: true, result: { replacedFiles, replacedOccurrences, errors } }
}
