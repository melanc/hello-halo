/**
 * Resolve current Git branch (or short SHA when detached) for a file path.
 * Runs `git -C <parentDir>` so any path inside a repo works.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'

const execFileAsync = promisify(execFile)

const GIT_OPTS = {
  maxBuffer: 64 * 1024,
  timeout: 8000,
  windowsHide: true,
} as const

export async function getGitBranchForPath(absoluteFilePath: string): Promise<string | null> {
  const cwd = dirname(absoluteFilePath)
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      GIT_OPTS
    )
    const ref = stdout.trim()
    if (!ref) return null
    if (ref === 'HEAD') {
      try {
        const { stdout: short } = await execFileAsync(
          'git',
          ['-C', cwd, 'rev-parse', '--short', 'HEAD'],
          GIT_OPTS
        )
        const sha = short.trim()
        return sha || null
      } catch {
        return null
      }
    }
    return ref
  } catch {
    return null
  }
}
