/**
 * SlashCommandMenu - Autocomplete popup for "/" quick-input in the chat input area.
 *
 * Behaviour:
 *  - Appears above the textarea when the user types "/" at the start of the input.
 *  - Filters items in real-time as the user types after the slash.
 *  - Groups items into two sections: Skills / Built-in.
 *  - The selected row is highlighted; selection is driven by the parent via `selectedIndex`.
 *  - Clicking a row calls `onSelect`; clicking outside calls `onClose`.
 *  - The menu scrolls the selected row into view automatically.
 *
 * Keyboard navigation is intentionally delegated to InputArea so that the textarea
 * keeps focus throughout — this component is purely presentational.
 *
 * Design:
 *  - Follows Halo's existing dropdown language: bg-popover, border-border, rounded-xl, shadow-lg.
 *  - Selected row: subtle bg-primary/10 + left accent bar (border-l-2 border-primary).
 *  - Hover: hover:bg-muted/50 — matches InputArea's attachment menu items.
 *  - Category badge: neutral muted pill, no bright colours.
 */

import { useEffect, useRef, useMemo } from 'react'
import type { SlashCommandItem } from '../../types/slash-command'
import { useTranslation } from '../../i18n'

// Maximum rows visible without scrolling
const MAX_VISIBLE_ROWS = 8

interface SlashCommandMenuProps {
  /** Full list of available commands — filtering is done here */
  items: SlashCommandItem[]
  /** Text after the leading "/" used to filter the list */
  filter: string
  /** Index into the *filtered* list that is currently selected */
  selectedIndex: number
  /** Called when the user clicks or presses Enter/Tab on a row */
  onSelect: (item: SlashCommandItem) => void
  /** Called when the user clicks outside or presses Escape */
  onClose: () => void
}

// Category label map — neutral labels only, no per-category colour
const CATEGORY_LABEL: Record<SlashCommandItem['category'], string> = {
  skill: 'Skill',
  builtin: 'Built-in',
}

/**
 * Filter and sort the command list by the current filter string.
 * Exported so InputArea can compute filtered length for keyboard-nav wrap-around.
 *
 * Matching logic:
 *  1. If filter is empty, show all items (skills first, then builtins).
 *  2. Otherwise, include items whose command or label contains the filter (case-insensitive).
 *     Items whose command *starts with* the filter rank above partial matches.
 */
export function filterSlashCommands(items: SlashCommandItem[], filter: string): SlashCommandItem[] {
  const q = filter.toLowerCase().trim()

  if (!q) {
    const order: SlashCommandItem['category'][] = ['skill', 'builtin']
    return [...items].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
  }

  const matched = items.filter(
    (item) => item.command.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
  )

  return matched.sort((a, b) => {
    const aStarts = a.command.toLowerCase().startsWith('/' + q) ? 0 : 1
    const bStarts = b.command.toLowerCase().startsWith('/' + q) ? 0 : 1
    if (aStarts !== bStarts) return aStarts - bStarts
    return a.command.localeCompare(b.command)
  })
}

export function SlashCommandMenu({
  items,
  filter,
  selectedIndex,
  onSelect,
  onClose,
}: SlashCommandMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)

  const filtered = useMemo(() => filterSlashCommands(items, filter), [items, filter])

  // Scroll the selected row into view whenever selectedIndex changes
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Click-outside closes the menu
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (filtered.length === 0) {
    return (
      <div
        ref={menuRef}
        className="absolute bottom-full left-0 mb-2 w-full max-w-sm
          bg-popover border border-border rounded-xl shadow-lg z-30
          px-3 py-2 text-sm text-muted-foreground"
      >
        {t('No commands found')}
      </div>
    )
  }

  // Build row list with section headers inserted before each category change
  const rows: Array<
    | { type: 'header'; category: SlashCommandItem['category'] }
    | { type: 'item'; item: SlashCommandItem; index: number }
  > = []
  let lastCategory: SlashCommandItem['category'] | null = null
  filtered.forEach((item, idx) => {
    if (item.category !== lastCategory) {
      rows.push({ type: 'header', category: item.category })
      lastCategory = item.category
    }
    rows.push({ type: 'item', item, index: idx })
  })

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-full max-w-md
        bg-popover border border-border rounded-xl shadow-lg z-30
        overflow-hidden"
      style={{ maxHeight: `${MAX_VISIBLE_ROWS * 42 + 36}px` }}
    >
      {/* Scrollable item list */}
      <div className="overflow-y-auto" style={{ maxHeight: `${MAX_VISIBLE_ROWS * 42}px` }}>
        <div className="py-1">
          {rows.map((row) => {
            if (row.type === 'header') {
              return (
                <div
                  key={`header-${row.category}`}
                  className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider
                    text-muted-foreground/50 select-none"
                >
                  {t(CATEGORY_LABEL[row.category])}
                </div>
              )
            }

            const { item, index } = row
            const isSelected = index === selectedIndex

            return (
              <button
                key={item.id}
                ref={isSelected ? selectedRowRef : null}
                onMouseDown={(e) => {
                  // mousedown keeps focus on the textarea
                  e.preventDefault()
                  onSelect(item)
                }}
                className={`
                  w-full flex items-center gap-2 text-left
                  transition-colors duration-75 min-h-[38px]
                  border-l-2
                  ${isSelected
                    ? 'bg-primary/10 border-primary pl-2.5 pr-3'
                    : 'border-transparent pl-2.5 pr-3 hover:bg-muted/50'
                  }
                `}
              >
                {/* Command — monospace, primary colour */}
                <span className={`font-mono text-sm shrink-0 truncate
                  ${isSelected ? 'text-primary' : 'text-primary/80'}`}>
                  {item.command}
                  {item.argumentHint && (
                    <span className="text-muted-foreground/50 ml-1 font-normal">{item.argumentHint}</span>
                  )}
                </span>

                {/* Description — secondary, truncated */}
                {item.description && (
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {item.description}
                  </span>
                )}

                {/* Category pill — neutral, right-aligned */}
                <span className="ml-auto shrink-0 text-[10px] font-medium
                  text-muted-foreground/60 bg-muted/60 rounded px-1.5 py-0.5">
                  {t(CATEGORY_LABEL[item.category])}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer keyboard hint */}
      <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3
        text-[10px] text-muted-foreground/40 select-none">
        <span>↑↓ {t('navigate')}</span>
        <span>↵ {t('select')}</span>
        <span>Esc {t('close')}</span>
      </div>
    </div>
  )
}
