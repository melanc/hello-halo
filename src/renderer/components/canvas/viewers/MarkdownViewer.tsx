/**
 * Markdown Viewer - Rendered markdown with editable source toggle
 *
 * Features:
 * - Beautiful markdown rendering
 * - Toggle between rendered preview and editable source view
 * - Edit markdown directly in source mode
 * - Save (Cmd+S) to persist changes
 * - Code block syntax highlighting
 * - Copy to clipboard
 * - Open with external application
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Copy, Check, Code, Eye, ExternalLink, Save } from 'lucide-react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { useCodePlugin } from '../../../lib/streamdown-plugins'
import { api } from '../../../api'
import { useNotificationStore } from '../../../stores/notification.store'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useTranslation } from '../../../i18n'

/**
 * Resolve relative image paths to devx-file:// protocol URLs
 * This bypasses cross-origin restrictions in dev mode (http://localhost -> file://)
 */
function resolveImageSrc(src: string | undefined, basePath: string): string {
  if (!src) return ''

  // Keep absolute URLs and data URIs as-is
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src
  }

  // No base path available, return original
  if (!basePath) return src

  // Resolve relative paths to devx-file:// protocol
  if (src.startsWith('./')) {
    return `devx-file://${basePath}/${src.slice(2)}`
  }

  if (src.startsWith('../')) {
    const parts = basePath.split('/')
    const srcParts = src.split('/')
    while (srcParts[0] === '..') {
      parts.pop()
      srcParts.shift()
    }
    return `devx-file://${parts.join('/')}/${srcParts.join('/')}`
  }

  if (src.startsWith('/')) {
    return `devx-file://${src}`
  }

  // Relative path without prefix
  return `devx-file://${basePath}/${src}`
}

interface MarkdownViewerProps {
  tab: CanvasTab
  onScrollChange?: (position: number) => void
}

export function MarkdownViewer({ tab, onScrollChange }: MarkdownViewerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
  const [editContent, setEditContent] = useState<string>('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const codePlugin = useCodePlugin()

  // Get the base directory of the markdown file for resolving relative paths
  const basePath = tab.path ? tab.path.substring(0, tab.path.lastIndexOf('/')) : ''

  // Reset edit state when tab changes
  useEffect(() => {
    setEditContent(tab.content || '')
    setIsDirty(false)
  }, [tab.id, tab.content])

  // Restore scroll position
  useEffect(() => {
    if (containerRef.current && tab.scrollPosition !== undefined) {
      containerRef.current.scrollTop = tab.scrollPosition
    }
  }, [tab.id, viewMode])

  // Focus textarea when switching to source mode
  useEffect(() => {
    if (viewMode === 'source' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [viewMode])

  // Save scroll position
  const handleScroll = useCallback(() => {
    if (containerRef.current && onScrollChange) {
      onScrollChange(containerRef.current.scrollTop)
    }
  }, [onScrollChange])

  // Copy content
  const handleCopy = async () => {
    const text = viewMode === 'source' ? editContent : (tab.content || '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Open with external application
  const handleOpenExternal = async () => {
    if (!tab.path) return
    try {
      await api.openArtifact(tab.path)
    } catch (err) {
      console.error('Failed to open with external app:', err)
    }
  }

  // Handle source editing
  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setEditContent(newContent)
    setIsDirty(newContent !== tab.content)
  }, [tab.content])

  // Save changes
  const handleSave = useCallback(async () => {
    if (!tab.path || isSaving) return
    if (!isDirty) return

    setIsSaving(true)
    try {
      const result = await api.saveArtifactContent(tab.path, editContent)
      if (result.success) {
        setIsDirty(false)
        useNotificationStore.getState().show({
          title: t('File saved'),
          body: '',
          variant: 'success',
          duration: 2000,
        })
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
  }, [tab.path, editContent, isDirty, isSaving, t])

  // Switch to source mode and initialize content
  const handleSwitchToSource = useCallback(() => {
    setEditContent(tab.content || '')
    setIsDirty(false)
    setViewMode('source')
  }, [tab.content])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd+S / Ctrl+S: Save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (viewMode === 'source' && isDirty) {
        void handleSave()
      }
      return
    }

    // Cmd+Shift+P / Ctrl+Shift+P: Toggle view mode
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault()
      if (viewMode === 'rendered') {
        handleSwitchToSource()
      } else {
        setViewMode('rendered')
      }
      return
    }

    // Escape: switch to preview if in source mode
    if (e.key === 'Escape' && viewMode === 'source') {
      e.preventDefault()
      setViewMode('rendered')
    }
  }, [viewMode, isDirty, handleSave, handleSwitchToSource])

  const displayContent = viewMode === 'rendered' ? (tab.content || '') : editContent
  const canOpenExternal = !api.isRemoteMode() && tab.path

  return (
    <div
      className="relative flex flex-col h-full bg-background"
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md bg-secondary/50 p-0.5">
            <button
              onClick={() => setViewMode('rendered')}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'rendered'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
              title={t('Preview (Cmd+Shift+P)')}
            >
              <Eye className="w-3.5 h-3.5" />
              {t('Preview')}
            </button>
            <button
              onClick={handleSwitchToSource}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'source'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
              title={t('Source (Cmd+Shift+P)')}
            >
              <Code className="w-3.5 h-3.5" />
              {t('Source')}
            </button>
          </div>

          {/* Dirty indicator dot */}
          {isDirty && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
              <span>{t('Unsaved')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Save button (source mode + dirty) */}
          {viewMode === 'source' && isDirty && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              title={t('Save (Cmd+S)')}
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? t('Saving...') : t('Save')}
            </button>
          )}

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            title={t('Copy')}
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
        </div>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto"
      >
        {viewMode === 'rendered' ? (
          <div className="prose prose-invert max-w-none p-6 sm:p-8">
            <Streamdown
              mode="static"
              controls={{ code: true }}
              plugins={codePlugin ? { code: codePlugin } : undefined}
              components={{
                // Style tables
                table({ children }) {
                  return (
                    <div className="overflow-x-auto">
                      <table className="min-w-full">{children}</table>
                    </div>
                  )
                },
                // Links - add target="_blank" (styling from tailwind.config.cjs)
                a({ href, children }: any) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  )
                },
                // Style images - resolve relative paths using devx-file:// protocol
                img({ src, alt }: any) {
                  return (
                    <img
                      src={resolveImageSrc(src, basePath)}
                      alt={alt}
                      className="h-auto rounded-lg"
                      // Don't stretch small images, limit large ones (like GitHub ~880px)
                      style={{ maxWidth: 'min(100%, 880px)' }}
                    />
                  )
                }
              }}
            >
              {tab.content || ''}
            </Streamdown>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={handleEditChange}
            className="w-full h-full resize-none border-0 bg-background text-foreground font-mono text-sm p-4 leading-6 focus:outline-none focus:ring-0"
            spellCheck={false}
            placeholder={t('Start editing markdown...')}
          />
        )}
      </div>
    </div>
  )
}
