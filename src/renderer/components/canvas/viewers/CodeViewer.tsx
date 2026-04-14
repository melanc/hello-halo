/**
 * Code Viewer — CodeMirror-based file editor for the canvas
 *
 * Features:
 * - Syntax highlighting, folding, search (Cmd+F), line numbers
 * - Editor is always writable; ⌘/Ctrl+S persists when `tab.path` exists, Esc reverts unsaved edits
 * - Scroll position preservation
 * - Add selection to chat (composer reference chips)
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { api } from '../../../api'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useChatStore } from '../../../stores/chat.store'
import { useNotificationStore } from '../../../stores/notification.store'
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

interface CodeViewerProps {
  tab: CanvasTab
  onScrollChange?: (position: number) => void
  onContentChange?: (content: string) => void
  onSaveComplete?: (content: string) => void
}

export function CodeViewer({ tab, onScrollChange, onContentChange, onSaveComplete }: CodeViewerProps) {
  const { t } = useTranslation()
  const addComposerReferenceChip = useChatStore((s) => s.addComposerReferenceChip)
  const editorRef = useRef<CodeMirrorEditorRef>(null)
  const [isSaving, setIsSaving] = useState(false)

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

  const handleCancelEdit = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.setContent(tab.content || '')
    }
  }, [tab.content])

  const handleSave = useCallback(async () => {
    if (!tab.path || !editorRef.current) return

    if (!editorRef.current.hasChanges()) {
      return
    }

    setIsSaving(true)
    try {
      const newContent = editorRef.current.getContent()
      const result = await api.saveArtifactContent(tab.path, newContent)

      if (result.success) {
        onSaveComplete?.(newContent)
      } else {
        useNotificationStore.getState().show({
          title: t('Failed to save file'),
          body: result.error || t('Unknown error'),
          variant: 'error',
          duration: 6000,
        })
      }
    } catch (err) {
      console.error('Failed to save:', err)
      useNotificationStore.getState().show({
        title: t('Failed to save file'),
        body: (err as Error).message || t('Unknown error'),
        variant: 'error',
        duration: 6000,
      })
    } finally {
      setIsSaving(false)
    }
  }, [tab.path, onSaveComplete, t])

  const handleScroll = useCallback(
    (position: number) => {
      onScrollChange?.(position)
    },
    [onScrollChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSaving) return
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [isSaving, handleSave, handleCancelEdit]
  )

  // Focus editor when tab becomes active / content loads so ⌘S targets the file
  useEffect(() => {
    if (!tab.isLoading) {
      editorRef.current?.focus()
    }
  }, [tab.id, tab.isLoading])

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-background" onKeyDown={handleKeyDown}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirrorEditor
          ref={editorRef}
          content={tab.content || ''}
          language={tab.language}
          readOnly={false}
          onChange={onContentChange}
          onScroll={handleScroll}
          scrollPosition={tab.scrollPosition}
          onAddSelectionToChat={handleAddSelectionToChat}
        />
      </div>
    </div>
  )
}
