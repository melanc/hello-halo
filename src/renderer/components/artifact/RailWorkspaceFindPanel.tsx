/**
 * Cursor-style workspace find / replace for the artifact rail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaseSensitive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Regex,
  Replace,
  Search,
  WholeWord,
} from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { useCanvasLifecycle } from '../../hooks/useCanvasLifecycle'
import type { WorkspaceSearchMatch } from '../../../shared/types/workspace-search'

function MatchPreview({
  text,
  column,
  length,
}: {
  text: string
  column: number
  length: number
}) {
  const start = Math.max(0, column - 1)
  const before = text.slice(0, start)
  const mid = text.slice(start, start + length)
  const after = text.slice(start + length)
  return (
    <span className="font-mono text-[10px] truncate block min-w-0">
      <span className="text-muted-foreground">{before}</span>
      <span className="bg-primary/30 text-foreground rounded-[2px] px-px">{mid}</span>
      <span className="text-muted-foreground">{after}</span>
    </span>
  )
}

export function RailWorkspaceFindPanel({
  spaceId,
  isWebMode,
}: {
  spaceId: string
  isWebMode: boolean
}) {
  const { t } = useTranslation()
  const { openFile } = useCanvasLifecycle()

  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [matches, setMatches] = useState<WorkspaceSearchMatch[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)

  const findInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const searchOptions = useMemo(
    () => ({
      caseSensitive,
      wholeWord: useRegex ? false : wholeWord,
      useRegex,
    }),
    [caseSensitive, wholeWord, useRegex]
  )

  const runSearch = useCallback(async () => {
    if (!spaceId || isWebMode) return
    const q = find.trim()
    if (!q) {
      setMatches([])
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    setReplaceNote(null)
    try {
      const res = await api.workspaceSearch(spaceId, q, searchOptions)
      if (res.success && res.data) {
        setMatches(res.data)
        setActiveIdx(0)
      } else {
        setMatches([])
        setError(res.error ?? t('Search failed'))
      }
    } catch {
      setMatches([])
      setError(t('Search failed'))
    } finally {
      setSearching(false)
    }
  }, [spaceId, isWebMode, find, searchOptions, t])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void runSearch()
    }, 280)
    return () => window.clearTimeout(id)
  }, [find, caseSensitive, wholeWord, useRegex, spaceId, isWebMode, runSearch])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    setActiveIdx((i) => (i <= 0 ? matches.length - 1 : i - 1))
  }, [matches.length])

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    setActiveIdx((i) => (i >= matches.length - 1 ? 0 : i + 1))
  }, [matches.length])

  useEffect(() => {
    const el = rowRefs.current.get(activeIdx)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const onReplaceAll = useCallback(async () => {
    if (!spaceId || isWebMode) return
    const q = find.trim()
    if (!q) return
    setReplaceBusy(true)
    setReplaceNote(null)
    setError(null)
    try {
      const res = await api.workspaceReplaceAll(spaceId, q, replace, searchOptions)
      if (res.success && res.data) {
        setReplaceNote(
          t('Replaced {{count}} in {{files}} files', {
            count: res.data.replacedOccurrences,
            files: res.data.replacedFiles,
          })
        )
        if (res.data.errors.length) {
          setError(res.data.errors.slice(0, 2).join(' · '))
        }
        await runSearch()
      } else {
        setError(res.error ?? t('Replace failed'))
      }
    } catch {
      setError(t('Replace failed'))
    } finally {
      setReplaceBusy(false)
    }
  }, [spaceId, isWebMode, find, replace, searchOptions, runSearch, t])

  const toggleBtn = (on: boolean) =>
    `shrink-0 p-1 rounded transition-colors ${
      on ? 'bg-background text-foreground shadow-sm border border-border/60' : 'text-muted-foreground hover:bg-secondary/80'
    }`

  if (isWebMode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 text-center text-xs text-muted-foreground">
        {t('Please open folder in client')}
      </div>
    )
  }

  if (!spaceId) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-xs text-muted-foreground">
        {t('No workspace')}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card/20">
      <div className="flex-shrink-0 border-b border-border/80 bg-muted/30 px-2 py-1.5 space-y-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <input
              ref={findInputRef}
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runSearch()
                }
                if (e.key === 'Escape') {
                  findInputRef.current?.blur()
                }
              }}
              placeholder={t('Find')}
              className="w-full h-7 pl-7 pr-2 text-[11px] rounded-md border border-border/70 bg-background/90 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              className={toggleBtn(caseSensitive)}
              title={t('Match case')}
              onClick={() => setCaseSensitive((v) => !v)}
            >
              <CaseSensitive className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className={toggleBtn(wholeWord)}
              title={t('Match whole word')}
              disabled={useRegex}
              onClick={() => setWholeWord((v) => !v)}
            >
              <WholeWord className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className={toggleBtn(useRegex)}
              title={t('Use regular expression')}
              onClick={() => setUseRegex((v) => !v)}
            >
              <Regex className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
            title={t('Toggle replace')}
          >
            <Replace className="w-3 h-3" />
            <ChevronDown className={`w-3 h-3 transition-transform ${showReplace ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {matches.length === 0
              ? searching
                ? t('Searching…')
                : t('No results')
              : t('{{current}} of {{total}}', {
                  current: Math.min(activeIdx + 1, matches.length),
                  total: matches.length,
                })}
          </span>
          <button
            type="button"
            className="p-0.5 rounded hover:bg-secondary/80 text-muted-foreground disabled:opacity-40"
            onClick={goPrev}
            disabled={matches.length === 0}
            title={t('Previous match')}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded hover:bg-secondary/80 text-muted-foreground disabled:opacity-40"
            onClick={goNext}
            disabled={matches.length === 0}
            title={t('Next match')}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1 pt-0.5 border-t border-border/40">
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder={t('Replace')}
              className="flex-1 min-w-0 h-7 px-2 text-[11px] rounded-md border border-border/70 bg-background/90 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void onReplaceAll()}
              disabled={replaceBusy || !find.trim()}
              className="shrink-0 h-7 px-2 rounded-md text-[10px] font-medium border border-border/70 bg-secondary/80 hover:bg-secondary text-foreground disabled:opacity-40"
            >
              {t('Replace all')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="flex-shrink-0 px-2 py-1 text-[10px] text-destructive border-b border-border/40">{error}</p>
      )}
      {replaceNote && !error && (
        <p className="flex-shrink-0 px-2 py-1 text-[10px] text-muted-foreground border-b border-border/40">
          {replaceNote}
        </p>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {matches.map((m, i) => (
          <button
            key={`${m.path}:${m.line}:${m.column}:${i}`}
            type="button"
            ref={(el) => {
              if (el) rowRefs.current.set(i, el)
              else rowRefs.current.delete(i)
            }}
            onClick={() => {
              setActiveIdx(i)
              void openFile(m.path, m.relativePath.split('/').pop() ?? m.relativePath, {
                openDefaultEditable: true,
              })
            }}
            className={`w-full text-left px-2 py-1.5 border-b border-border/30 flex gap-2 min-w-0 hover:bg-secondary/40 ${
              i === activeIdx ? 'bg-accent/25' : ''
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                <span className="truncate font-mono">{m.relativePath}</span>
                <span className="shrink-0">:{m.line}</span>
              </div>
              <MatchPreview text={m.preview} column={m.column} length={m.length} />
            </div>
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/50 self-center" />
          </button>
        ))}
      </div>
    </div>
  )
}
