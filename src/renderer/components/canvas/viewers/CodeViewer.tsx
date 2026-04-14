/**
 * Code Viewer - Code viewer with optional read-only mode
 *
 * Features:
 * - CodeMirror 6 powered with virtual scrolling (large file support)
 * - Can open in edit mode when tab.openDefaultEditable (e.g. from artifact rail)
 * - View mode with explicit edit / save / cancel
 * - Syntax highlighting for 20+ languages
 * - Code folding, search (Cmd+F), line numbers
 * - Scroll position preservation
 * - Copy to clipboard, open external
 * - Add to Chat: adds a removable reference chip in the main composer (not raw textarea text)
 */

import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import {
  Copy,
  Check,
  ExternalLink,
  Pencil,
  Save,
  X,
  FileCode,
} from 'lucide-react'
import { api } from '../../../api'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useChatStore } from '../../../stores/chat.store'
import { useTranslation } from '../../../i18n'
import {
  CodeMirrorEditor,
  type CodeMirrorEditorRef,
  type AddSelectionToChatPayload,
} from './CodeMirrorEditor'

function fileNameFromTabPath(path: string | undefined, title: string): string {
  if (path) {
    const norm = path.replace(/\\/g, '/')
    const seg = norm.split('/').pop()
    if (seg) return seg
  }
  return title
}

// ============================================
// Types
// ============================================

interface CodeViewerProps {
  tab: CanvasTab
  onScrollChange?: (position: number) => void
  onContentChange?: (content: string) => void
  onSaveComplete?: (content: string) => void
}

// ============================================
// Component
// ============================================

export function CodeViewer({ tab, onScrollChange, onContentChange, onSaveComplete }: CodeViewerProps) {
  const { t } = useTranslation()
  const addComposerReferenceChip = useChatStore((s) => s.addComposerReferenceChip)
  const editorRef = useRef<CodeMirrorEditorRef>(null)

  const handleAddSelectionToChat = useCallback(
    ({ startLine, endLine }: AddSelectionToChatPayload) => {
      const displayName = fileNameFromTabPath(tab.path, tab.title) || t('File')
      const rangeLabel =
        startLine === endLine
          ? t('line {{n}}', { n: startLine })
          : t('lines {{start}}–{{end}}', { start: startLine, end: endLine })
      addComposerReferenceChip(t('{{file}} ({{range}})', { file: displayName, range: rangeLabel }))
    },
    [tab.path, tab.title, addComposerReferenceChip, t]
  )

  // State
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(() => Boolean(tab.path && tab.openDefaultEditable))
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Computed values
  const canOpenExternal = !api.isRemoteMode() && tab.path
  const canEdit = !!tab.path // Can only edit files with a path

  useEffect(() => {
    setIsEditing(Boolean(tab.path && tab.openDefaultEditable))
    setSaveError(null)
  }, [tab.id, tab.path, tab.openDefaultEditable])
  const lineCount = useMemo(() => (tab.content || '').split('\n').length, [tab.content])

  // ============================================
  // Handlers
  // ============================================

  // Copy content to clipboard
  const handleCopy = useCallback(async () => {
    const content = editorRef.current?.getContent() || tab.content
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [tab.content])

  // Open with external application
  const handleOpenExternal = useCallback(async () => {
    if (!tab.path) return
    try {
      await api.openArtifact(tab.path)
    } catch (err) {
      console.error('Failed to open with external app:', err)
    }
  }, [tab.path])

  // Enter edit mode
  const handleEnterEdit = useCallback(() => {
    setIsEditing(true)
    setSaveError(null)
    // Focus editor after mode switch
    setTimeout(() => {
      editorRef.current?.focus()
    }, 100)
  }, [])

  // Cancel edit mode
  const handleCancelEdit = useCallback(() => {
    // Restore original content
    if (editorRef.current) {
      editorRef.current.setContent(tab.content || '')
    }
    setIsEditing(false)
    setSaveError(null)
  }, [tab.content])

  // Save changes
  const handleSave = useCallback(async () => {
    if (!tab.path || !editorRef.current) return

    const newContent = editorRef.current.getContent()

    // Check if content actually changed
    if (!editorRef.current.hasChanges()) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const result = await api.saveArtifactContent(tab.path, newContent)

      if (result.success) {
        // Mark tab as saved (clears dirty flag) via callback
        if (onSaveComplete) {
          onSaveComplete(newContent)
        }
        setIsEditing(false)
      } else {
        setSaveError(result.error || t('Failed to save file'))
      }
    } catch (err) {
      console.error('Failed to save:', err)
      setSaveError((err as Error).message || t('Failed to save file'))
    } finally {
      setIsSaving(false)
    }
  }, [tab.path, onSaveComplete, t])

  // Handle scroll
  const handleScroll = useCallback(
    (position: number) => {
      if (onScrollChange) {
        onScrollChange(position)
      }
    },
    [onScrollChange]
  )

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl + S to save in edit mode
      if (isEditing && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      // Escape to cancel edit
      if (isEditing && e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [isEditing, handleSave, handleCancelEdit]
  )

  // ============================================
  // Render
  // ============================================

  return (
    <div
      className="relative flex flex-col h-full bg-background"
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        {/* Left: File info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileCode className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="font-mono">{tab.language || 'text'}</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{t('{{count}} lines', { count: lineCount })}</span>
          {/* mimeType hidden - redundant with language in most cases */}
          {/* {tab.mimeType && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>{tab.mimeType}</span>
            </>
          )} */}
          {isEditing && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-primary font-medium">{t('Editing')}</span>
            </>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {isEditing ? (
            // Edit mode actions
            <>
              {/* Save error message */}
              {saveError && (
                <span className="text-xs text-destructive mr-2">{saveError}</span>
              )}

              {/* Cancel button */}
              <button
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded
                         hover:bg-secondary transition-colors text-muted-foreground
                         disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('Cancel (Esc)')}
              >
                <X className="w-3.5 h-3.5" />
                <span>{t('Cancel')}</span>
              </button>

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded
                         bg-primary text-primary-foreground hover:bg-primary/90
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('Save (⌘S)')}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? t('Saving...') : t('Save')}</span>
              </button>
            </>
          ) : (
            // View mode actions
            <>
              {/* Edit button */}
              {canEdit && (
                <button
                  onClick={handleEnterEdit}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                  title={t('Edit file')}
                >
                  <Pencil className="w-4 h-4 text-muted-foreground" />
                </button>
              )}

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className="p-1.5 rounded hover:bg-secondary transition-colors"
                title={t('Copy code')}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>

              {/* Open with external app */}
              {canOpenExternal && (
                <button
                  onClick={handleOpenExternal}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                  title={t('Open in external application')}
                >
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Code Editor */}
      <div className="flex-1 overflow-hidden">
        <CodeMirrorEditor
          ref={editorRef}
          content={tab.content || ''}
          language={tab.language}
          readOnly={!isEditing}
          onChange={isEditing ? onContentChange : undefined}
          onScroll={handleScroll}
          scrollPosition={tab.scrollPosition}
          onAddSelectionToChat={handleAddSelectionToChat}
        />
      </div>
    </div>
  )
}
