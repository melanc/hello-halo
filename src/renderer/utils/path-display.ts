/**
 * Display paths relative to the current space root (matches agent working directory).
 */

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * If `absolutePath` is under `workspaceRoot`, return a relative POSIX-style path;
 * otherwise return `absolutePath` unchanged.
 */
export function toWorkspaceRelativePath(
  absolutePath: string,
  workspaceRoot: string | undefined | null
): string {
  if (!workspaceRoot || !absolutePath) return absolutePath

  const root = normalizeSlashes(workspaceRoot)
  const file = normalizeSlashes(absolutePath)
  const rootLower = root.toLowerCase()
  const fileLower = file.toLowerCase()

  if (fileLower === rootLower) {
    return '.'
  }
  if (!fileLower.startsWith(rootLower + '/')) {
    return absolutePath
  }
  // Preserve original casing from `file` after the root prefix
  const prefixLen = root.length + 1
  const rel = file.slice(prefixLen)
  return rel || '.'
}
