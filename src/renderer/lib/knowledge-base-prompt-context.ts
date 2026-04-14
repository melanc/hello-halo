/**
 * Load Markdown files from a knowledge-base space into a single prompt appendix.
 * Used by workspace task pipeline and requirement flows.
 */

import { api } from '../api'
import type { Artifact, WorkspaceTask } from '../types'

const MD_EXT = /^(md|markdown)$/i

function isMarkdownArtifact(a: Artifact): boolean {
  if (a.type !== 'file') return false
  const ext = (a.extension || '').replace(/^\./, '').toLowerCase()
  if (MD_EXT.test(ext)) return true
  return /\.md$/i.test(a.name) || /\.markdown$/i.test(a.name)
}

/**
 * Reads .md / .markdown files under the space workspace (flat list, bounded depth),
 * concatenates excerpts for LLM context. Returns empty string on failure or none.
 */
export async function fetchKnowledgeBaseMarkdownForPrompt(spaceId: string): Promise<string> {
  const sid = spaceId.trim()
  if (!sid) return ''
  try {
    const res = await api.listArtifacts(sid, 12)
    if (!res.success || !Array.isArray(res.data)) return ''
    const files = (res.data as Artifact[])
      .filter(isMarkdownArtifact)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'))

    const MAX_TOTAL = 48_000
    const MAX_PER_FILE = 10_000
    const MAX_FILES = 28
    let total = 0
    const blocks: string[] = []

    for (const f of files.slice(0, MAX_FILES)) {
      if (total >= MAX_TOTAL) break
      const read = await api.readArtifactContent(f.path)
      if (!read.success || !read.data) continue
      const data = read.data as { content?: string; encoding?: string }
      if (data.encoding === 'base64') continue
      const text = (data.content || '').trim()
      if (!text) continue
      const slice = text.length > MAX_PER_FILE ? `${text.slice(0, MAX_PER_FILE)}\n\n…` : text
      const header = `### ${f.relativePath}\n\n`
      const chunk = header + slice
      if (total + chunk.length > MAX_TOTAL) {
        blocks.push(chunk.slice(0, Math.max(0, MAX_TOTAL - total)))
        break
      }
      blocks.push(chunk)
      total += chunk.length
    }
    return blocks.join('\n\n---\n\n')
  } catch {
    return ''
  }
}

/** Loads KB markdown when `task.knowledgeBaseSpaceId` is set. */
export async function loadKnowledgeBaseContextForTask(task: WorkspaceTask): Promise<string> {
  const kb = task.knowledgeBaseSpaceId?.trim()
  if (!kb) return ''
  return fetchKnowledgeBaseMarkdownForPrompt(kb)
}
