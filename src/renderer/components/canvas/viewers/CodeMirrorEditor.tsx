/**
 * CodeMirror Editor Component
 *
 * A React wrapper for CodeMirror 6 with:
 * - Virtual scrolling for large files
 * - Read-only mode by default
 * - Optional edit mode with undo/redo
 * - Theme integration with Halo (auto light/dark)
 * - Scroll position preservation
 *
 * Performance optimizations:
 * - Uses refs to avoid recreating extensions on callback changes
 * - Memoized with React.memo to prevent unnecessary re-renders
 * - Stable extensions array to avoid reinitializing CodeMirror
 *
 * This is the core component - CodeViewer wraps this with UI chrome.
 */

import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  memo,
  useState,
} from 'react'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { MessageSquare } from 'lucide-react'
import {
  createEditorState,
  setReadOnly,
  setLanguage,
  getContent,
  setContent,
  hasChanges,
} from '../../../lib/codemirror-setup'
import { useTranslation } from '../../../i18n'

// ============================================
// Types
// ============================================

/** 1-based line numbers of the current selection (inclusive) */
export interface AddSelectionToChatPayload {
  startLine: number
  endLine: number
}

export interface CodeMirrorEditorProps {
  /** Document content */
  content: string
  /** Programming language for syntax highlighting */
  language?: string
  /** Read-only mode (default: true) */
  readOnly?: boolean
  /** Called when content changes (only in edit mode) */
  onChange?: (content: string) => void
  /** Called when scroll position changes */
  onScroll?: (position: number) => void
  /** Initial scroll position to restore */
  scrollPosition?: number
  /** CSS class name for the container */
  className?: string
  /** When set, a non-empty selection shows an “Add to Chat” control (canvas code viewer) */
  onAddSelectionToChat?: (payload: AddSelectionToChatPayload) => void
  /** Cmd/Ctrl+S from inside the editor (bubbles do not reliably reach a parent div) */
  onRequestSave?: () => void
}

export interface CodeMirrorEditorRef {
  /** Get the current document content */
  getContent: () => string
  /** Set the document content */
  setContent: (content: string) => void
  /** Check if content has been modified */
  hasChanges: () => boolean
  /** Set read-only mode */
  setReadOnly: (readOnly: boolean) => void
  /** Focus the editor */
  focus: () => void
  /** Get the scroll position */
  getScrollPosition: () => number
  /** Set the scroll position */
  setScrollPosition: (position: number) => void
  /** Get the EditorView instance */
  getView: () => EditorView | null
  /** Align change tracking with disk/store after a successful save */
  setSavedBaseline: () => void
}

// ============================================
// Component
// ============================================

export const CodeMirrorEditor = memo(
  forwardRef<CodeMirrorEditorRef, CodeMirrorEditorProps>(function CodeMirrorEditor(
    {
      content,
      language,
      readOnly = true,
      onChange,
      onScroll,
      scrollPosition,
      className = '',
      onAddSelectionToChat,
      onRequestSave,
    },
    ref
  ) {
    const { t } = useTranslation()
    const containerRef = useRef<HTMLDivElement>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const originalContentRef = useRef<string>(content)
    const lastScrollPositionRef = useRef<number>(0)
    const onAddToChatRef = useRef(onAddSelectionToChat)
    const [addToChatPopup, setAddToChatPopup] = useState<{
      left: number
      top: number
      startLine: number
      endLine: number
    } | null>(null)
    const setAddToChatPopupRef = useRef(setAddToChatPopup)
    setAddToChatPopupRef.current = setAddToChatPopup

    // Keep refs up to date with latest callbacks
    const onChangeRef = useRef(onChange)
    const onScrollRef = useRef(onScroll)
    // Suppresses onChange during programmatic content updates (e.g. tab switch)
    const isProgrammaticUpdateRef = useRef(false)

    useEffect(() => {
      onAddToChatRef.current = onAddSelectionToChat
      if (!onAddSelectionToChat) {
        setAddToChatPopup(null)
      }
    }, [onAddSelectionToChat])

    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useEffect(() => {
      onScrollRef.current = onScroll
    }, [onScroll])

    const onRequestSaveRef = useRef(onRequestSave)
    useEffect(() => {
      onRequestSaveRef.current = onRequestSave
    }, [onRequestSave])

    // Build extensions array - stable across re-renders using refs
    const extensions = useMemo(() => {
      let addToChatRaf = 0
      return [
        Prec.high(
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                const fn = onRequestSaveRef.current
                if (!fn) return false
                fn()
                return true
              },
            },
          ])
        ),

        EditorView.updateListener.of((update) => {
          const cb = onAddToChatRef.current
          const setPop = setAddToChatPopupRef.current
          if (!cb) {
            cancelAnimationFrame(addToChatRaf)
            setPop(null)
            return
          }
          const view = update.view
          const sel = view.state.selection.main
          const selected = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to)
          if (!selected.trim()) {
            cancelAnimationFrame(addToChatRaf)
            setPop(null)
            return
          }
          cancelAnimationFrame(addToChatRaf)
          addToChatRaf = requestAnimationFrame(() => {
            if (!view.dom.isConnected || !onAddToChatRef.current) {
              setPop(null)
              return
            }
            const wrap = wrapperRef.current
            if (!wrap) {
              setPop(null)
              return
            }
            const coords = view.coordsAtPos(sel.head)
            if (!coords) {
              setPop(null)
              return
            }
            const r = wrap.getBoundingClientRect()
            const btnApproxWidth = 168
            const leftRaw = coords.left - r.left
            const left = Math.max(6, Math.min(leftRaw, Math.max(6, r.width - btnApproxWidth - 6)))
            const top = coords.bottom - r.top + 6
            const doc = view.state.doc
            const startLine = doc.lineAt(sel.from).number
            const endLine = doc.lineAt(sel.to).number
            setPop({ left, top, startLine, endLine })
          })
        }),

        // Update listener for content changes
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current && !isProgrammaticUpdateRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),

        // Scroll listener
        EditorView.domEventHandlers({
          scroll: (_event, view) => {
            const scrollTop = view.scrollDOM.scrollTop
            lastScrollPositionRef.current = scrollTop
            if (onScrollRef.current) {
              onScrollRef.current(scrollTop)
            }
            return false
          },
        }),
      ]
    }, [])

    // Initialize editor once on mount
    useEffect(() => {
      if (!containerRef.current) return

      // Create initial state
      const state = createEditorState({
        doc: content,
        language,
        readOnly,
        extensions,
      })

      // Create view
      const view = new EditorView({
        state,
        parent: containerRef.current,
      })

      viewRef.current = view
      originalContentRef.current = content

      // Restore scroll position if provided
      if (scrollPosition !== undefined && scrollPosition > 0) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          view.scrollDOM.scrollTop = scrollPosition
        })
      }

      return () => {
        view.destroy()
        viewRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // Intentionally empty - initialize once, update via separate effects

    // Update content when prop changes (programmatic — must not trigger onChange)
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      const currentContent = view.state.doc.toString()
      if (currentContent !== content) {
        isProgrammaticUpdateRef.current = true
        setContent(view, content)
        isProgrammaticUpdateRef.current = false
        originalContentRef.current = content
      }
    }, [content])

    // Update language when prop changes
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      setLanguage(view, language)
    }, [language])

    // Update read-only mode when prop changes
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      setReadOnly(view, readOnly)

      // If switching to read-only, update original content reference
      if (readOnly) {
        originalContentRef.current = view.state.doc.toString()
      }
    }, [readOnly])

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        getContent: () => {
          const view = viewRef.current
          return view ? getContent(view) : content
        },

        setContent: (newContent: string) => {
          const view = viewRef.current
          if (view) {
            setContent(view, newContent)
          }
        },

        hasChanges: () => {
          const view = viewRef.current
          return view ? hasChanges(view, originalContentRef.current) : false
        },

        setReadOnly: (isReadOnly: boolean) => {
          const view = viewRef.current
          if (view) {
            setReadOnly(view, isReadOnly)
            if (isReadOnly) {
              originalContentRef.current = view.state.doc.toString()
            }
          }
        },

        focus: () => {
          const view = viewRef.current
          if (view) {
            view.focus()
          }
        },

        getScrollPosition: () => {
          const view = viewRef.current
          return view ? view.scrollDOM.scrollTop : lastScrollPositionRef.current
        },

        setScrollPosition: (position: number) => {
          const view = viewRef.current
          if (view) {
            view.scrollDOM.scrollTop = position
          }
        },

        getView: () => viewRef.current,

        setSavedBaseline: () => {
          const view = viewRef.current
          if (view) {
            originalContentRef.current = view.state.doc.toString()
          }
        },
      }),
      [content]
    )

    return (
      <div ref={wrapperRef} className={`relative h-full w-full min-h-0 ${className}`}>
        <div ref={containerRef} className="codemirror-container h-full w-full overflow-hidden" />
        {addToChatPopup && onAddSelectionToChat ? (
          <div
            className="pointer-events-auto absolute z-[200]"
            style={{ left: addToChatPopup.left, top: addToChatPopup.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-2 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent hover:text-accent-foreground sm:py-1.5"
              onClick={() => {
                onAddSelectionToChat({
                  startLine: addToChatPopup.startLine,
                  endLine: addToChatPopup.endLine,
                })
                setAddToChatPopup(null)
              }}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              {t('Add to Chat')}
            </button>
          </div>
        ) : null}
      </div>
    )
  })
)

CodeMirrorEditor.displayName = 'CodeMirrorEditor'
