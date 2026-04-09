/**
 * Source control panel — shared renderer types (mirrors main git-workspace.service).
 */

export interface GitWorkspaceFileRow {
  path: string
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

export interface GitBranchListData {
  branches: string[]
  current: string | null
}
