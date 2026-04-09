/**
 * Parse assistant breakdown Markdown into a tree for task UI (top-level actions + nested items).
 */

import type { Message } from '../types'

const MAX_ITEM_DETAIL = 8000
const MAX_FALLBACK = 12000

export interface BreakdownTreeNode {
  title: string
  detail: string
  children: BreakdownTreeNode[]
}

function capDetail(detail: string): string {
  if (detail.length <= MAX_ITEM_DETAIL) return detail
  return `${detail.slice(0, MAX_ITEM_DETAIL)}\n…`
}

/** Flatten subtree text for implementation kickoff prompts. */
export function flattenBreakdownSubtree(node: BreakdownTreeNode): string {
  const parts: string[] = []
  if (node.detail?.trim()) parts.push(node.detail.trim())
  for (const c of node.children) {
    parts.push(c.title)
    const sub = flattenBreakdownSubtree(c)
    if (sub) parts.push(sub)
  }
  return parts.join('\n\n')
}

const NUM_KEY = /^\d+(?:\.\d+)*$/

function parentKeyOf(key: string): string | null {
  const p = key.lastIndexOf('.')
  return p === -1 ? null : key.slice(0, p)
}

/** Lines like `1. Foo` (top) and `1.1 Bar` (nested under 1). */
function tryParseNumberedTree(text: string): BreakdownTreeNode[] | null {
  const lines = text.split(/\r?\n/)
  type Entry = { lineIndex: number; key: string; restTitle: string }
  const entries: Entry[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*((?:\d+\.)*\d+)\s*[.)]\s+(.+)$/)
    if (!m) continue
    const key = m[1]
    if (!NUM_KEY.test(key)) continue
    entries.push({ lineIndex: i, key, restTitle: m[2].trim() })
  }
  if (entries.length === 0) return null

  const byKey = new Map<string, BreakdownTreeNode>()
  const roots: BreakdownTreeNode[] = []

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    const title = `${e.key}. ${e.restTitle}`
    const node: BreakdownTreeNode = { title, detail: '', children: [] }
    const pk = parentKeyOf(e.key)
    if (pk === null) {
      roots.push(node)
    } else {
      const parent = byKey.get(pk)
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    byKey.set(e.key, node)

    const bodyStart = e.lineIndex + 1
    const boundary = i + 1 < entries.length ? entries[i + 1].lineIndex : lines.length
    node.detail = capDetail(lines.slice(bodyStart, boundary).join('\n').trim())
  }

  return roots
}

/** ## sections with optional ### children. */
function tryParseHeaderTree(text: string): BreakdownTreeNode[] | null {
  const lines = text.split(/\r?\n/)
  const h2: { line: number; title: string }[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+)$/)
    if (m) h2.push({ line: i, title: m[1].trim() })
  }
  if (h2.length === 0) return null

  const roots: BreakdownTreeNode[] = []
  for (let i = 0; i < h2.length; i += 1) {
    const start = h2[i].line + 1
    const end = i + 1 < h2.length ? h2[i + 1].line : lines.length
    const chunk = lines.slice(start, end)
    const h3Indices: number[] = []
    for (let j = 0; j < chunk.length; j += 1) {
      if (/^###\s+/.test(chunk[j])) h3Indices.push(j)
    }
    const node: BreakdownTreeNode = { title: h2[i].title, detail: '', children: [] }
    if (h3Indices.length === 0) {
      node.detail = capDetail(chunk.join('\n').trim())
    } else {
      node.detail = capDetail(chunk.slice(0, h3Indices[0]).join('\n').trim())
      for (let k = 0; k < h3Indices.length; k += 1) {
        const title = chunk[h3Indices[k]].replace(/^###\s+/, '').trim()
        const from = h3Indices[k] + 1
        const to = k + 1 < h3Indices.length ? h3Indices[k + 1] : chunk.length
        node.children.push({
          title,
          detail: capDetail(chunk.slice(from, to).join('\n').trim()),
          children: [],
        })
      }
    }
    roots.push(node)
  }
  return roots
}

function fallbackBlob(text: string): BreakdownTreeNode[] {
  const lines = text.split(/\r?\n/)
  const firstLine = lines[0]?.trim() || text.slice(0, 120)
  const rest = lines.slice(1).join('\n').trim()
  return [{ title: firstLine.slice(0, 200), detail: capDetail(rest || text), children: [] }]
}

/**
 * Numbered outline first (1 / 1.1), then ## / ###, else single blob.
 */
export function parseImplementationBreakdownTree(markdown: string): BreakdownTreeNode[] {
  const t = markdown.trim()
  if (!t) return []
  const numbered = tryParseNumberedTree(t)
  if (numbered && numbered.length > 0) return numbered
  const headers = tryParseHeaderTree(t)
  if (headers && headers.length > 0) return headers
  return fallbackBlob(t)
}

/** Next top-level "1." index (after max existing). */
export function nextTopLevelNumberedIndex(markdown: string): number {
  let max = 0
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\.\s/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

/**
 * Markdown for a new top-level breakdown item (numbered vs ## to match existing plan).
 */
export function formatAppendTopLevelBreakdownSection(
  existingMarkdown: string | undefined,
  title: string,
  detail: string
): string {
  const t = title.trim()
  const d = detail.trim()
  if (!t) return ''
  const src = (existingMarkdown ?? '').trim()
  if (/^\s*\d+\.\s/m.test(src)) {
    const n = nextTopLevelNumberedIndex(src)
    return d ? `${n}. ${t}\n\n${d}` : `${n}. ${t}`
  }
  return d ? `## ${t}\n\n${d}` : `## ${t}`
}

/** Canonical H2 for merged “add from conversation” excerpts (stable in saved Markdown). */
export const DEVX_CHAT_EXCERPTS_HEADING_TITLE = 'DevX chat excerpts'

/** Older UI used translated titles as the ## line; still treat as the same bucket. */
const LEGACY_CHAT_EXCERPT_HEADINGS = new Set([
  'Conversation excerpt',
  '会话摘录',
  '會話摘錄',
])

export function isChatExcerptsSectionTitle(title: string): boolean {
  const s = title.trim()
  return s === DEVX_CHAT_EXCERPTS_HEADING_TITLE || LEGACY_CHAT_EXCERPT_HEADINGS.has(s)
}

function blockquoteExcerpt(excerpt: string): string {
  return excerpt
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}

function parseH2PlainTitle(line: string): string | null {
  const m = line.match(/^##\s+(.+)$/)
  return m ? m[1].trim() : null
}

/** Top-level numbered line only (`1. Foo`, not `1.1 Bar`). */
function parseNumberedTopLevelLine(line: string): {
  indent: string
  num: string
  delim: string
  rest: string
} | null {
  const m = line.match(/^(\s*)((?:\d+\.)*\d+)\s*([.)])\s+(.+)$/)
  if (!m) return null
  const key = m[2]
  if (key.includes('.')) return null
  return { indent: m[1], num: key, delim: m[3], rest: m[4].trim() }
}

function appendConversationExcerptToHeadingBreakdown(md: string, quote: string): string {
  const canonicalHeading = `## ${DEVX_CHAT_EXCERPTS_HEADING_TITLE}`
  const lines = md.split('\n')
  let hIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const tit = parseH2PlainTitle(lines[i])
    if (tit && isChatExcerptsSectionTitle(tit)) {
      hIdx = i
      break
    }
  }
  if (hIdx === -1) {
    return `${md}\n\n${canonicalHeading}\n\n${quote}`
  }
  const tit = parseH2PlainTitle(lines[hIdx])
  if (tit && tit !== DEVX_CHAT_EXCERPTS_HEADING_TITLE) {
    lines[hIdx] = canonicalHeading
  }
  let end = lines.length
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  const before = lines.slice(0, end).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').trim()
  const suffix = after ? `\n\n${after}` : ''
  return `${before}\n\n${quote}${suffix}`
}

function appendConversationExcerptToNumberedBreakdown(src: string, quote: string): string {
  const lines = src.split('\n')
  let bucketLine = -1
  for (let i = 0; i < lines.length; i++) {
    const p = parseNumberedTopLevelLine(lines[i])
    if (p && isChatExcerptsSectionTitle(p.rest)) {
      bucketLine = i
      break
    }
  }
  if (bucketLine === -1) {
    const n = nextTopLevelNumberedIndex(src)
    return `${src.trimEnd()}\n\n${n}. ${DEVX_CHAT_EXCERPTS_HEADING_TITLE}\n\n${quote}`
  }
  const p = parseNumberedTopLevelLine(lines[bucketLine])!
  lines[bucketLine] = `${p.indent}${p.num}${p.delim} ${DEVX_CHAT_EXCERPTS_HEADING_TITLE}`
  let end = lines.length
  for (let i = bucketLine + 1; i < lines.length; i++) {
    if (parseNumberedTopLevelLine(lines[i])) {
      end = i
      break
    }
  }
  const before = lines.slice(0, end).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').trim()
  const suffix = after ? `\n\n${after}` : ''
  return `${before}\n\n${quote}${suffix}`
}

/**
 * Append into one shared bucket (blockquotes), not a new sub-task row each time.
 * ## section for heading-style plans; one top-level `N.` item for numbered plans.
 */
export function appendConversationExcerptToBreakdownMarkdown(markdown: string | undefined, excerpt: string): string {
  const quote = blockquoteExcerpt(excerpt)
  const md = (markdown ?? '').replace(/\r\n/g, '\n').trimEnd()
  if (!md) {
    return `## ${DEVX_CHAT_EXCERPTS_HEADING_TITLE}\n\n${quote}`
  }
  if (/^\s*\d+\.\s/m.test(md)) {
    return appendConversationExcerptToNumberedBreakdown(md, quote)
  }
  return appendConversationExcerptToHeadingBreakdown(md, quote)
}

/** UI label for the merged chat-excerpt bucket (keeps `3.` prefix for numbered plans). */
export function resolveChatExcerptsBucketDisplayTitle(title: string, bucketLabel: string): string {
  const plain = title.trim()
  if (isChatExcerptsSectionTitle(plain)) return bucketLabel
  const m = plain.match(/^(\d+)\.\s+(.+)$/)
  if (m && isChatExcerptsSectionTitle(m[2].trim())) {
    return `${m[1]}. ${bucketLabel}`
  }
  return title
}

/** Heuristic: latest assistant message that looks like a structured breakdown. */
export function extractLastAssistantPlanFromMessages(messages: Message[]): string {
  const rev = [...messages].reverse()
  for (const m of rev) {
    if (m.role !== 'assistant') continue
    const c = typeof m.content === 'string' ? m.content.trim() : ''
    if (c.length < 80) continue
    if (/(^|\n)#{2,3}\s+/.test(c) || /^\s*\d+[.)]\s+/m.test(c)) return c
  }
  for (const m of rev) {
    if (m.role !== 'assistant') continue
    const c = typeof m.content === 'string' ? m.content.trim() : ''
    if (c.length > 400) return c.length > MAX_FALLBACK ? `${c.slice(0, MAX_FALLBACK)}\n\n…` : c
  }
  return ''
}
