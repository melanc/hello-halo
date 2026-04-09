/**
 * Workspace file search / replace (artifact rail, Cursor-style find in files)
 */

export interface WorkspaceSearchMatch {
  path: string
  relativePath: string
  line: number
  column: number
  length: number
  preview: string
}

export interface WorkspaceSearchOptionsInput {
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  maxResults?: number
  maxFileBytes?: number
  /** Top-level directory names under workspace root (e.g. task project dirs) */
  relativeRoots?: string[]
}

export interface WorkspaceSearchOptionsResolved {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  maxResults: number
  maxFileBytes: number
  relativeRoots?: string[]
}

export interface WorkspaceReplaceAllResult {
  replacedFiles: number
  replacedOccurrences: number
  errors: string[]
}
