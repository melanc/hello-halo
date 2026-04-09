/**
 * User message body: render @ file/folder references as inline chips (Cursor-style),
 * not plain backtick text.
 */

import { memo, useMemo } from 'react'
import { FileText, Folder } from 'lucide-react'
import { DEVX_REF_CLOSE, DEVX_REF_OPEN } from '../../../shared/chat-artifact-refs'

type ContentPart = { type: 'text'; text: string } | { type: 'ref'; path: string }

function looksLikeArtifactPath(inner: string): boolean {
  const s = inner.trim()
  if (!s || s.length > 400 || s.includes('`')) return false
  if (s.includes('/') || s.includes('\\')) return true
  return /\.[a-zA-Z0-9]{1,12}$/.test(s)
}

function lastSegmentLooksLikeFile(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || ''
  return base.includes('.') && !base.startsWith('.')
}

/** Split user-visible content into plain text runs and workspace reference chips. */
export function parseUserMessageContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = []
  let i = 0
  while (i < raw.length) {
    const devx = raw.indexOf(DEVX_REF_OPEN, i)
    const tick = raw.indexOf('`', i)
    let next = -1
    let kind: 'devx' | 'tick' | null = null
    if (devx >= 0 && (tick < 0 || devx <= tick)) {
      next = devx
      kind = 'devx'
    } else if (tick >= 0) {
      next = tick
      kind = 'tick'
    } else {
      parts.push({ type: 'text', text: raw.slice(i) })
      break
    }
    if (next > i) {
      parts.push({ type: 'text', text: raw.slice(i, next) })
    }
    if (kind === 'devx') {
      const close = raw.indexOf(DEVX_REF_CLOSE, next + DEVX_REF_OPEN.length)
      if (close < 0) {
        parts.push({ type: 'text', text: raw.slice(next) })
        break
      }
      const encoded = raw.slice(next + DEVX_REF_OPEN.length, close)
      try {
        const path = decodeURIComponent(encoded)
        if (path) {
          parts.push({ type: 'ref', path })
        } else {
          parts.push({ type: 'text', text: raw.slice(next, close + DEVX_REF_CLOSE.length) })
        }
      } catch {
        parts.push({ type: 'text', text: raw.slice(next, close + DEVX_REF_CLOSE.length) })
      }
      i = close + DEVX_REF_CLOSE.length
      continue
    }
    const closeTick = raw.indexOf('`', next + 1)
    if (closeTick < 0) {
      parts.push({ type: 'text', text: raw.slice(next) })
      break
    }
    const inner = raw.slice(next + 1, closeTick)
    if (looksLikeArtifactPath(inner)) {
      parts.push({ type: 'ref', path: inner.trim() })
    } else {
      parts.push({ type: 'text', text: raw.slice(next, closeTick + 1) })
    }
    i = closeTick + 1
  }
  return parts
}

const ArtifactRefChip = memo(function ArtifactRefChip({ path }: { path: string }) {
  const isFile = lastSegmentLooksLikeFile(path)
  const Icon = isFile ? FileText : Folder
  const label = path.replace(/[/\\]+$/, '') || path

  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle mx-0.5 max-w-[min(100%,260px)] rounded-md border border-primary/25 bg-background/40 px-1.5 py-0.5 text-[11px] font-mono text-foreground/95 shadow-sm backdrop-blur-sm"
      title={path}
    >
      <span className="text-[10px] font-sans text-muted-foreground/90 select-none" aria-hidden>
        @
      </span>
      <Icon className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
})

export const UserMessageContent = memo(function UserMessageContent({ content }: { content: string }) {
  const parts = useMemo(() => parseUserMessageContent(content), [content])

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, idx) =>
        p.type === 'text' ? (
          <span key={idx}>{p.text}</span>
        ) : (
          <ArtifactRefChip key={idx} path={p.path} />
        )
      )}
    </span>
  )
})
