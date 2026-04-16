/**
 * Input Area - Enhanced message input with bottom toolbar
 *
 * Layout (following industry standard - Qwen, ChatGPT, Baidu):
 * ┌──────────────────────────────────────────────────────┐
 * │ [Image previews]                                     │
 * │ ┌──────────────────────────────────────────────────┐ │
 * │ │ Textarea                                         │ │
 * │ └──────────────────────────────────────────────────┘ │
 * │ [+] [⚛]─────────────────────────────────  [Send] │
 * │      Bottom toolbar: always visible, expandable     │
 * └──────────────────────────────────────────────────────┘
 *
 * Features:
 * - Auto-resize textarea
 * - Keyboard shortcuts (Enter to send, Shift+Enter newline)
 * - Image paste/drop support with compression
 * - Extended thinking mode toggle (theme-colored)
 * - Bottom toolbar for future extensibility
 */

import { useState, useRef, useEffect, useMemo, useCallback, KeyboardEvent, ClipboardEvent, DragEvent } from 'react'
import { Plus, ImagePlus, Loader2, AlertCircle, Atom, Globe, X, FileText, Folder, Mic, ListChecks } from 'lucide-react'
import { useAppStore } from '../../stores/app.store'
import { useChatStore } from '../../stores/chat.store'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useAIBrowserStore } from '../../stores/ai-browser.store'
import { getOnboardingPrompt } from '../onboarding/onboardingData'
import { ImageAttachmentPreview } from './ImageAttachmentPreview'
import { SpeechVolumeMeter } from './SpeechVolumeMeter'
import { processImage, isValidImageType, formatFileSize } from '../../utils/imageProcessor'
import {
  extractWordDocument,
  dataUrlToImageFile,
  DOC_IMG_PLACEHOLDER,
} from '../../utils/wordDocumentExtract'
import type { ImageAttachment, Artifact } from '../../types'
import { useTranslation } from '../../i18n'
import { SlashCommandMenu, filterSlashCommands } from './SlashCommandMenu'
import type { SlashCommandItem } from '../../types/slash-command'
import {
  useSpeechRecognition,
  mapUiLangToSpeechLang,
  isSpeechRecognitionSupported,
  type SpeechRecognitionUpdate,
} from '../../hooks/useSpeechRecognition'
import { useOfflineWhisperSpeech } from '../../hooks/useOfflineWhisperSpeech'
import { api } from '../../api'
import { isElectron } from '../../api/transport'
import {
  formatArtifactReference,
  consumeArtifactRefSentinelsFromText,
} from '../../../shared/chat-artifact-refs'

/** Append a finalized speech segment with sensible spacing (Latin vs CJK-friendly). */
function appendCommittedChunk(accumulated: string, piece: string): string {
  const t = piece.trim()
  if (!t) return accumulated
  if (!accumulated) return t
  if (/\s$/.test(accumulated) || /^\s/.test(t)) return accumulated + t
  return accumulated + ' ' + t
}

/** Build live textarea body: committed finals + current interim preview. */
function joinCommittedWithInterim(committed: string, interim: string): string {
  if (!interim) return committed
  if (!committed) return interim
  if (/\s$/.test(committed) || /^\s/.test(interim)) return committed + interim
  return committed + ' ' + interim
}

function lastSegmentLooksLikeFile(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || ''
  return base.includes('.') && !base.startsWith('.')
}

function newMentionPathChipId(): string {
  return `wp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ── @ mention helpers ──

interface MentionMatch {
  query: string
  start: number
  end: number
}

function getMentionMatch(value: string, cursorPosition: number): MentionMatch | null {
  const beforeCursor = value.slice(0, cursorPosition)
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/)
  if (!match || match.index === undefined) return null
  const start = match.index + match[1].length
  return { query: match[2] || '', start, end: cursorPosition }
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase()
}

function matchesFuzzyPathPrefix(relativePath: string, query: string): boolean {
  const normalizedPath = normalizePathLike(relativePath)
  const normalizedQuery = normalizePathLike(query)
  if (!normalizedQuery) return true
  if (normalizedPath.includes(normalizedQuery)) return true
  const pathSegments = normalizedPath.split('/').filter(Boolean)
  const querySegments = normalizedQuery.split('/').filter(Boolean)
  if (querySegments.length === 0) return true
  if (querySegments.length > pathSegments.length) return false
  for (let i = 0; i < querySegments.length; i += 1) {
    if (!pathSegments[i]?.startsWith(querySegments[i])) return false
  }
  return true
}

/** Extra min/max textarea height (px) when viewing a focused task conversation */
const TASK_FOCUS_COMPOSER_EXTRA_HEIGHT_PX = 60

interface InputAreaProps {
  onSend: (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean) => void
  onStop: () => void
  isGenerating: boolean
  placeholder?: string
  isCompact?: boolean
  /** Taller composer when user opened a task (min + max growable height) */
  isTaskFocusComposer?: boolean
  /** Available slash commands for the "/" quick-input autocomplete */
  slashCommands?: SlashCommandItem[]
  /** Artifacts available for @ mention suggestions */
  mentionArtifacts?: Artifact[]
  /** Main chat only: code reference chips from canvas "Add to Chat" */
  composerReferenceChips?: Array<{ id: string; label: string }>
  onRemoveComposerReferenceChip?: (id: string) => void
  clearComposerReferenceChips?: () => void
  /** Active task context shown as a small label inside the top-left of the input box */
  taskContext?: { name: string; stage: string }
}

// Image constraints
const MAX_IMAGE_SIZE = 20 * 1024 * 1024  // 20MB max per image (before compression)
const MAX_IMAGES = 10  // Max images per message

// Error message type
interface ImageError {
  id: string
  message: string
}

export function InputArea({
  onSend,
  onStop,
  isGenerating,
  placeholder,
  isCompact = false,
  isTaskFocusComposer = false,
  slashCommands = [],
  mentionArtifacts = [],
  composerReferenceChips = [],
  onRemoveComposerReferenceChip,
  clearComposerReferenceChips,
  taskContext,
}: InputAreaProps) {
  const { t, i18n } = useTranslation()
  const textareaMaxHeightPx = 200 + (isTaskFocusComposer ? TASK_FOCUS_COMPOSER_EXTRA_HEIGHT_PX : 0)
  const textareaMinHeightPx = 24 + (isTaskFocusComposer ? TASK_FOCUS_COMPOSER_EXTRA_HEIGHT_PX : 0)
  const sendKeyMode = useAppStore(state => state.config?.chat?.sendKeyMode ?? 'enter')
  const appConfig = useAppStore((state) => state.config)
  const [content, setContent] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [isProcessingWord, setIsProcessingWord] = useState(false)
  const [imageError, setImageError] = useState<ImageError | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(true)  // Extended thinking mode
  const [showAttachMenu, setShowAttachMenu] = useState(false)  // Attachment menu visibility
  // Slash-command autocomplete
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  // @ mention autocomplete (P1 fix: track cursor as state for correct useMemo deps)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [cursorPos, setCursorPos] = useState(0)
  /** @ file/folder picks — shown as chips; sent as [[devx-ref:…]] (not raw text in the textarea). */
  const [mentionPathChips, setMentionPathChips] = useState<Array<{ id: string; path: string }>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerFocusTick = useChatStore((s) => s.composerFocusTick)
  const prevComposerFocusTickRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wordInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const prevChipCountRef = useRef(0)
  /** Avoid duplicate chip rows when React Strict Mode runs the migration effect twice. */
  const lastMigratedSentinelContentRef = useRef<string | null>(null)
  const speechPrefixRef = useRef('')
  const speechSuffixRef = useRef('')
  const speechCommittedRef = useRef('')
  const webSpeechSupported = useMemo(() => isSpeechRecognitionSupported(), [])
  const offlineSpeechEnabled = appConfig?.offlineSpeech?.enabled === true
  const [offlineSpeechReady, setOfflineSpeechReady] = useState(false)

  useEffect(() => {
    if (composerFocusTick === prevComposerFocusTickRef.current) return
    prevComposerFocusTickRef.current = composerFocusTick
    if (composerFocusTick === 0) return
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
  }, [composerFocusTick])

  useEffect(() => {
    if (!isElectron() || !offlineSpeechEnabled) {
      setOfflineSpeechReady(false)
      return
    }
    let cancelled = false
    void api.offlineSpeechStatus().then((r) => {
      if (cancelled) return
      const available = Boolean(r.success && r.data && (r.data as { available?: boolean }).available)
      setOfflineSpeechReady(available)
    })
    return () => {
      cancelled = true
    }
  }, [
    offlineSpeechEnabled,
    appConfig?.offlineSpeech?.whisperBinPath,
    appConfig?.offlineSpeech?.whisperModelPath,
  ])

  const useOfflineDictation = offlineSpeechEnabled && offlineSpeechReady
  const showSpeechMic =
    useOfflineDictation ||
    (!offlineSpeechEnabled && webSpeechSupported) ||
    (offlineSpeechEnabled && isElectron())
  const micBlockedOffline = offlineSpeechEnabled && !offlineSpeechReady

  // AI Browser state
  const { enabled: aiBrowserEnabled, setEnabled: setAIBrowserEnabled } = useAIBrowserStore()

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (imageError) {
      const timer = setTimeout(() => setImageError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [imageError])

  // Close attachment menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
      }
    }

    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAttachMenu])

  // Show error to user
  const showError = (message: string) => {
    setImageError({ id: `err-${Date.now()}`, message })
  }

  const applySpeechUpdate = useCallback(({ finals, interim }: SpeechRecognitionUpdate) => {
    for (const piece of finals) {
      speechCommittedRef.current = appendCommittedChunk(speechCommittedRef.current, piece)
    }
    const body = joinCommittedWithInterim(speechCommittedRef.current, interim)
    const next = speechPrefixRef.current + body + speechSuffixRef.current
    setContent(next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      const end = speechPrefixRef.current.length + body.length
      el.focus()
      el.setSelectionRange(end, end)
      setCursorPos(end)
    })
  }, [])

  const onSpeechError = useCallback(
    (code: string) => {
      if (code === 'not-supported') {
        showError(t('Voice input is not supported in this environment'))
      } else if (code === 'not-allowed') {
        showError(t('Microphone permission denied'))
      } else if (code === 'network') {
        showError(
          isElectron()
            ? t(
                'Online voice input could not reach the speech server (firewall / region). Enable offline speech in Settings → Advanced to use whisper.cpp locally.'
              )
            : t(
                'Voice input requires an Internet connection. Speech is processed online — check network, firewall, or region.'
              )
        )
      } else if (code === 'start-failed') {
        showError(t('Voice input could not start. Try again.'))
      } else if (code === 'not-electron') {
        showError(t('Offline speech is only available in the desktop app.'))
      } else if (code === 'no-binary' || code === 'no-model' || code === 'disabled') {
        showError(t('Offline speech needs whisper.cpp binary and model files. Set paths in Settings → Advanced.'))
      } else if (code === 'timeout') {
        showError(t('Offline transcription timed out. Try a shorter phrase.'))
      } else if (code === 'transcribe-failed') {
        showError(t('Offline transcription failed.'))
      } else {
        showError(t('Voice input error: {{code}}', { code }))
      }
    },
    [t]
  )

  const { listening: webSpeechListening, start: startWebSpeech, stop: stopWebSpeech } = useSpeechRecognition({
    lang: mapUiLangToSpeechLang(i18n.language),
    onSpeechUpdate: applySpeechUpdate,
    onError: onSpeechError,
  })

  const offlineSpeech = useOfflineWhisperSpeech({
    i18nLanguage: i18n.language,
    onSpeechUpdate: applySpeechUpdate,
    onError: onSpeechError,
  })

  const speechListening = webSpeechListening || offlineSpeech.listening

  // Onboarding state
  const { isActive: isOnboarding, currentStep } = useOnboardingStore()
  const isOnboardingSendStep = isOnboarding && currentStep === 'send-message'

  // Move any pasted/legacy [[devx-ref:…]] tokens from the textarea into chips
  useEffect(() => {
    if (isOnboardingSendStep) return
    if (!content.includes('[[devx-ref:')) {
      lastMigratedSentinelContentRef.current = null
      return
    }
    if (lastMigratedSentinelContentRef.current === content) return
    const { text, paths } = consumeArtifactRefSentinelsFromText(content)
    if (paths.length === 0) return
    lastMigratedSentinelContentRef.current = content
    setMentionPathChips((prev) => [...prev, ...paths.map((path) => ({ id: newMentionPathChipId(), path }))])
    setContent(text)
  }, [content, isOnboardingSendStep])

  // Focus composer when a new reference chip is added (canvas “Add to Chat”)
  useEffect(() => {
    const n = composerReferenceChips.length
    if (
      onRemoveComposerReferenceChip &&
      n > prevChipCountRef.current &&
      !isOnboardingSendStep
    ) {
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      })
    }
    prevChipCountRef.current = n
  }, [composerReferenceChips.length, onRemoveComposerReferenceChip, isOnboardingSendStep])

  // In onboarding send step, show prefilled prompt
  const onboardingPrompt = getOnboardingPrompt(t)
  const displayContent = isOnboardingSendStep ? onboardingPrompt : content

  // Process file to ImageAttachment with professional compression
  const processFileWithCompression = async (file: File): Promise<ImageAttachment | null> => {
    // Validate type
    if (!isValidImageType(file)) {
      showError(t('Unsupported image format: {{type}}', { type: file.type || t('Unknown') }))
      return null
    }

    // Validate size (before compression)
    if (file.size > MAX_IMAGE_SIZE) {
      showError(t('Image too large ({{size}}), max 20MB', { size: formatFileSize(file.size) }))
      return null
    }

    try {
      // Use professional image processor for compression
      const processed = await processImage(file)

      return {
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        mediaType: processed.mediaType,
        data: processed.data,
        name: file.name,
        size: processed.compressedSize
      }
    } catch (error) {
      console.error(`Failed to process image: ${file.name}`, error)
      showError(t('Failed to process image: {{name}}', { name: file.name }))
      return null
    }
  }

  // Add images (with limit check and loading state)
  const isAttachmentBusy = isProcessingImages || isProcessingWord

  const handleVoiceInputClick = useCallback(() => {
    if (micBlockedOffline) {
      showError(t('Configure offline speech in Settings → Advanced.'))
      return
    }
    if (!showSpeechMic) {
      showError(t('Voice input is not supported in this environment'))
      return
    }
    if (isAttachmentBusy) return

    if (useOfflineDictation) {
      if (offlineSpeech.listening) {
        offlineSpeech.stop()
        return
      }
      setContent((prev) => {
        const a = Math.min(textareaRef.current?.selectionStart ?? prev.length, prev.length)
        speechPrefixRef.current = prev.slice(0, a)
        speechSuffixRef.current = prev.slice(a)
        speechCommittedRef.current = ''
        return prev
      })
      void offlineSpeech.start()
      return
    }

    if (webSpeechListening) {
      stopWebSpeech()
      return
    }
    setContent((prev) => {
      const a = Math.min(textareaRef.current?.selectionStart ?? prev.length, prev.length)
      speechPrefixRef.current = prev.slice(0, a)
      speechSuffixRef.current = prev.slice(a)
      speechCommittedRef.current = ''
      return prev
    })
    startWebSpeech()
  }, [
    micBlockedOffline,
    showSpeechMic,
    isAttachmentBusy,
    useOfflineDictation,
    offlineSpeech,
    webSpeechListening,
    stopWebSpeech,
    startWebSpeech,
    t,
    showError,
  ])

  const addImages = async (files: File[]) => {
    const remainingSlots = MAX_IMAGES - images.length
    if (remainingSlots <= 0) return

    const filesToProcess = files.slice(0, remainingSlots)

    // Show loading state during compression
    setIsProcessingImages(true)

    try {
      const newImages = await Promise.all(filesToProcess.map(processFileWithCompression))
      const validImages = newImages.filter((img): img is ImageAttachment => img !== null)

      if (validImages.length > 0) {
        setImages(prev => [...prev, ...validImages])
      }
    } finally {
      setIsProcessingImages(false)
    }
  }

  // Remove image
  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  // Handle paste event
  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()  // Prevent default only if we're handling images
      await addImages(imageFiles)
    }
  }

  // Handle drag events
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  // Handle artifact drag-drop reference insertion
  const handleDropReference = (rawPath: string): boolean => {
    const normalizedPath = normalizePathLike(rawPath)
    // P1 fix: use string match instead of RegExp
    const target = mentionArtifacts.find(a => {
      const rp = normalizePathLike(a.relativePath)
      return rp === normalizedPath || rp.endsWith('/' + normalizedPath)
    })
    if (!target) return false

    setMentionPathChips((prev) => [...prev, { id: newMentionPathChipId(), path: target.relativePath }])
    handleMentionClose()

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
        setCursorPos(len)
      }
    })
    return true
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    // Check for artifact drag-drop first
    const referencePath = e.dataTransfer.getData('text/halo-artifact-relative-path') || e.dataTransfer.getData('text/plain')
    if (referencePath && handleDropReference(referencePath)) {
      return
    }

    const files = Array.from(e.dataTransfer.files).filter(file => isValidImageType(file))

    if (files.length > 0) {
      await addImages(files)
    }
  }

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      await addImages(files)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle image button click (from attachment menu)
  const handleImageButtonClick = () => {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  const handleWordButtonClick = () => {
    setShowAttachMenu(false)
    wordInputRef.current?.click()
  }

  const handleWordInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (wordInputRef.current) wordInputRef.current.value = ''
    if (!file) return

    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.docx')) {
      showError(t('Only .docx format is supported for Word import'))
      return
    }

    setIsProcessingWord(true)
    try {
      const buf = await file.arrayBuffer()
      const { textWithPlaceholders, imageDataUrls } = await extractWordDocument(buf, {
        unsupportedImageLabel: t('Word document unsupported embedded image'),
      })

      const remainingSlots = MAX_IMAGES - images.length
      const newAttachments: ImageAttachment[] = []
      const baseName = file.name.replace(/\.docx$/i, '')

      let composed = textWithPlaceholders
      for (let i = 0; i < imageDataUrls.length; i++) {
        const ph = DOC_IMG_PLACEHOLDER(i + 1)
        const url = imageDataUrls[i]

        if (newAttachments.length >= remainingSlots) {
          composed = composed.split(ph).join(`\n${t('Word document image not attached limit')}\n`)
          continue
        }

        const f = dataUrlToImageFile(url, `${baseName}-img-${i + 1}`)
        if (!f) {
          composed = composed.split(ph).join(`\n${t('Word document image omitted')}\n`)
          continue
        }
        if (f.size > MAX_IMAGE_SIZE) {
          showError(t('Image too large ({{size}}), max 20MB', { size: formatFileSize(f.size) }))
          composed = composed.split(ph).join(`\n${t('Word document image omitted too large')}\n`)
          continue
        }
        const att = await processFileWithCompression(f)
        if (att) {
          newAttachments.push(att)
          composed = composed.split(ph).join(
            `\n${t('Word document inline image marker', { n: newAttachments.length })}\n`
          )
        } else {
          composed = composed.split(ph).join(`\n${t('Word document image omitted')}\n`)
        }
      }

      if (newAttachments.length > 0) {
        setImages((prev) => [...prev, ...newAttachments])
      }

      const hasBody = composed.trim().length > 0
      const hasImages = newAttachments.length > 0
      if (!hasBody && !hasImages) {
        showError(t('No text or images found in this Word document'))
        return
      }

      const header = t('Imported from Word document: {{name}}', { name: file.name })
      const block = hasBody ? `${header}\n\n${composed}\n\n` : `${header}\n\n`
      setContent((prev) => (prev.trim() ? `${block}${prev.trimStart()}` : block))
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        const len = textareaRef.current?.value.length ?? 0
        textareaRef.current?.setSelectionRange(len, len)
        setCursorPos(len)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showError(t('Failed to parse Word document: {{message}}', { message }))
    } finally {
      setIsProcessingWord(false)
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, textareaMaxHeightPx)}px`
    }
  }, [displayContent, textareaMaxHeightPx])

  // Focus on mount
  useEffect(() => {
    if (!isGenerating && !isOnboardingSendStep) {
      textareaRef.current?.focus()
    }
  }, [isGenerating, isOnboardingSendStep])

  // Slash-command helpers

  // Upper bound on filter length: the longest command label (e.g. "compact" = 7).
  // Computed once per commands list change — used to short-circuit onChange cheaply.
  const maxCommandLen = useMemo(
    () => slashCommands.reduce((max, c) => Math.max(max, c.label.length), 0),
    [slashCommands]
  )

  // `slashFilter` is the text typed after "/" — drives filtering and menu visibility.
  const slashFilter = slashMenuOpen && content.startsWith('/') ? content.slice(1) : ''

  // Pre-filtered, pre-sorted list — single source of truth for rendering and keyboard nav.
  // Only computed when the menu is open; returns [] otherwise (zero cost when closed).
  const filteredSlashCommands = useMemo(
    () => (slashMenuOpen ? filterSlashCommands(slashCommands, slashFilter) : []),
    [slashCommands, slashFilter, slashMenuOpen]
  )

  // @ mention match — depends on both content and cursor position (P1 fix)
  const mentionMatch = useMemo(
    () => getMentionMatch(content, cursorPos),
    [content, cursorPos]
  )

  // Filtered & scored mention artifacts — only computed when menu is open
  const filteredMentionArtifacts = useMemo(() => {
    if (!mentionMenuOpen) return []
    const query = mentionMatch?.query.trim() || ''
    const normalizedQuery = normalizePathLike(query)

    const score = (artifact: Artifact) => {
      const name = normalizePathLike(artifact.name)
      const rp = normalizePathLike(artifact.relativePath)
      if (!normalizedQuery) return artifact.type === 'folder' ? 0 : 1
      if (rp === normalizedQuery || name === normalizedQuery) return 0
      if (rp.startsWith(normalizedQuery)) return 1
      if (name.startsWith(normalizedQuery)) return 2
      if (rp.includes(normalizedQuery)) return 3
      return 10
    }

    return [...mentionArtifacts]
      .filter(a => matchesFuzzyPathPrefix(a.relativePath, query))
      .sort((a, b) => {
        const diff = score(a) - score(b)
        if (diff !== 0) return diff
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.relativePath.localeCompare(b.relativePath)
      })
      .slice(0, 50)
  }, [mentionArtifacts, mentionMatch, mentionMenuOpen])

  const handleSlashClose = () => {
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
  }

  const handleMentionClose = () => {
    setMentionMenuOpen(false)
    setMentionSelectedIndex(0)
  }

  const insertMention = (relativePath: string) => {
    const currentCursor = textareaRef.current?.selectionStart ?? content.length
    const match = getMentionMatch(content, currentCursor)
    if (!match) return

    const nextContent = `${content.slice(0, match.start)}${content.slice(match.end)}`
    const nextCursor = match.start

    setMentionPathChips((prev) => [...prev, { id: newMentionPathChipId(), path: relativePath }])
    setContent(nextContent)
    handleMentionClose()

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextCursor, nextCursor)
        setCursorPos(nextCursor)
      }
    })
  }

  const handleSlashSelect = (item: SlashCommandItem) => {
    const newContent = item.command + ' '
    setContent(newContent)
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
    // Resize textarea to fit the new (short) content and restore focus
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, textareaMaxHeightPx)}px`
        textareaRef.current.focus()
        // Place cursor at the end
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    })
  }

  // Handle send
  const handleSend = () => {
    stopWebSpeech()
    offlineSpeech.stop()
    const bodyText = isOnboardingSendStep ? onboardingPrompt : content.trim()
    const refBlock =
      composerReferenceChips.length > 0
        ? composerReferenceChips.map((c) => c.label).join('\n') + '\n\n'
        : ''
    const mentionBlock =
      mentionPathChips.length > 0
        ? mentionPathChips.map((c) => formatArtifactReference(c.path)).join(' ') + (bodyText ? ' ' : '')
        : ''
    const textToSend = (refBlock + mentionBlock + bodyText).trim()
    const hasContent = textToSend.length > 0 || images.length > 0

    if (hasContent && !isGenerating) {
      onSend(textToSend, images.length > 0 ? images : undefined, thinkingEnabled)

      if (!isOnboardingSendStep) {
        setContent('')
        setMentionPathChips([])
        setImages([])  // Clear images after send
        clearComposerReferenceChips?.()
        handleMentionClose()
        handleSlashClose()
        // Don't reset thinkingEnabled - user might want to keep it on
        // Reset height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      }
    }
  }

  // Detect mobile device (touch + narrow screen)
  const isMobile = () => {
    return 'ontouchstart' in window && window.innerWidth < 768
  }

  // Handle key press
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore key events during IME composition (Chinese/Japanese/Korean input)
    // This prevents Enter from sending the message while confirming IME candidates
    if (e.nativeEvent.isComposing) return

    // ── @ mention menu navigation ──────────────────────────────────────────────
    if (mentionMenuOpen && filteredMentionArtifacts.length > 0) {
      const mLen = filteredMentionArtifacts.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionSelectedIndex(i => (i + 1) % mLen)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionSelectedIndex(i => (i - 1 + mLen) % mLen)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const selected = filteredMentionArtifacts[mentionSelectedIndex]
        if (selected) insertMention(selected.relativePath)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleMentionClose()
        return
      }
    }

    // ── Slash-command menu navigation ─────────────────────────────────────────
    // filteredSlashCommands is already computed by useMemo — no extra filtering here.
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      const filteredLen = filteredSlashCommands.length

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i + 1) % filteredLen)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i - 1 + filteredLen) % filteredLen)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filteredSlashCommands[slashSelectedIndex]) {
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
        }
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (filteredSlashCommands[slashSelectedIndex]) {
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleSlashClose()
        return
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Mobile: send via button only
    // PC: respect sendKeyMode setting
    if (!isMobile()) {
      if (sendKeyMode === 'ctrl-enter') {
        // Ctrl+Enter to send, Enter for new line
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault()
          handleSend()
        }
      } else {
        // Enter to send, Shift+Enter for new line
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      }
    }
    // Esc to stop
    if (e.key === 'Escape' && isGenerating) {
      e.preventDefault()
      onStop()
    }
  }

  // In onboarding mode, can always send (prefilled content)
  // Can send if has text OR has images (and not processing/generating)
  const hasComposerChips = composerReferenceChips.length > 0
  const hasMentionPathChips = mentionPathChips.length > 0
  const canSend =
    isOnboardingSendStep ||
    (((content.trim().length > 0 || hasComposerChips || hasMentionPathChips || images.length > 0) &&
      !isGenerating &&
      !isAttachmentBusy))
  const hasImages = images.length > 0

  return (
    <div className={`
      border-t border-border/50 bg-background
      transition-[padding] duration-300 ease-out
      ${isCompact ? 'px-3 py-2' : 'px-4 py-3'}
    `}>
      <div className={isCompact ? '' : 'max-w-3xl mx-auto'}>
        {/* Error toast notification */}
        {imageError && (
          <div className="mb-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20
            flex items-start gap-2 animate-fade-in">
            <AlertCircle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
            <span className="text-sm text-destructive flex-1">{imageError.message}</span>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={wordInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleWordInputChange}
        />

        {/* Input container */}
        <div
          className={`
            relative flex flex-col rounded-2xl transition-all duration-200
            ${isFocused
              ? 'ring-1 ring-primary/30 bg-card shadow-sm'
              : 'bg-secondary/50 hover:bg-secondary/70'
            }
            ${isGenerating ? 'opacity-60' : ''}
            ${isDragOver ? 'ring-2 ring-primary/50 bg-primary/5' : ''}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Slash-command autocomplete menu — floats above the input box.
              Only rendered when there are actual matches; no empty-state UI. */}
          {slashMenuOpen && filteredSlashCommands.length > 0 && (
            <SlashCommandMenu
              items={filteredSlashCommands}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />
          )}
          {/* @ mention autocomplete menu */}
          {mentionMenuOpen && filteredMentionArtifacts.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-popover border border-border rounded-xl shadow-lg z-30 overflow-hidden">
              <div className="max-h-[336px] overflow-y-auto py-1">
                {filteredMentionArtifacts.map((artifact, index) => {
                  const isSelected = index === mentionSelectedIndex
                  return (
                    <button
                      key={`${artifact.path}-${artifact.type}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertMention(artifact.relativePath)
                      }}
                      className={`w-full flex items-center gap-2 text-left min-h-[38px] border-l-2 ${isSelected ? 'bg-primary/10 border-primary pl-2.5 pr-3' : 'border-transparent pl-2.5 pr-3 hover:bg-muted/50'}`}
                    >
                      <span className="text-xs font-medium text-primary/80 shrink-0">
                        {artifact.type === 'folder' ? t('Folder') : t('File')}
                      </span>
                      <span className="text-sm truncate flex-1 min-w-0">{artifact.relativePath}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/40 select-none">
                <span>↑↓ {t('navigate')}</span>
                <span>↵ {t('select')}</span>
                <span>Esc {t('close')}</span>
              </div>
            </div>
          )}
          {/* Image preview area */}
          {hasImages && (
            <ImageAttachmentPreview
              images={images}
              onRemove={removeImage}
            />
          )}

          {/* Code reference chips (canvas Add to Chat) — one bordered block, each tag removable */}
          {onRemoveComposerReferenceChip && composerReferenceChips.length > 0 && (
            <div className="px-3 pt-3">
              <div
                className="rounded-xl border border-border bg-muted/50 p-2 flex flex-wrap gap-2"
                role="group"
                aria-label={t('Code references')}
              >
                {composerReferenceChips.map((chip) => (
                  <div
                    key={chip.id}
                    className="inline-flex max-w-full items-center gap-0.5 rounded-lg border border-border/80 bg-background/90 pl-2.5 pr-1 py-1 text-xs text-foreground shadow-sm"
                  >
                    <span className="truncate font-mono min-w-0" title={chip.label}>
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveComposerReferenceChip(chip.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      aria-label={t('Remove')}
                      title={t('Remove')}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mentionPathChips.length > 0 && (
            <div className="px-3 pt-3">
              <div
                className="rounded-xl border border-border bg-muted/50 p-2 flex flex-wrap gap-2"
                role="group"
                aria-label={t('Workspace path mentions')}
              >
                {mentionPathChips.map((chip) => {
                  const isFile = lastSegmentLooksLikeFile(chip.path)
                  const PathIcon = isFile ? FileText : Folder
                  return (
                    <div
                      key={chip.id}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-lg border border-primary/25 bg-background/90 pl-1.5 pr-1 py-1 text-[11px] text-foreground shadow-sm"
                    >
                      <span className="text-[10px] font-sans text-muted-foreground shrink-0 select-none" aria-hidden>
                        @
                      </span>
                      <PathIcon className="h-3 w-3 shrink-0 opacity-75" aria-hidden />
                      <span className="truncate font-mono min-w-0" title={chip.path}>
                        {chip.path.replace(/[/\\]+$/, '') || chip.path}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMentionPathChips((prev) => prev.filter((c) => c.id !== chip.id))
                        }
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        aria-label={t('Remove')}
                        title={t('Remove')}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Image processing indicator */}
          {isProcessingImages && (
            <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground border-b border-border/30">
              <Loader2 size={14} className="animate-spin" />
              <span>{t('Processing image...')}</span>
            </div>
          )}
          {isProcessingWord && (
            <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground border-b border-border/30">
              <Loader2 size={14} className="animate-spin" />
              <span>{t('Processing Word document...')}</span>
            </div>
          )}

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center
              bg-primary/5 rounded-2xl border-2 border-dashed border-primary/30
              pointer-events-none z-10">
              <div className="flex flex-col items-center gap-2 text-primary/70">
                <ImagePlus size={24} />
                <span className="text-sm font-medium">{t('Drop to add images')}</span>
              </div>
            </div>
          )}

          {/* Active task tag — top-left inside the rounded input box */}
          {taskContext && (
            <div className="px-3 pt-2 pb-0 flex items-center gap-1.5 select-none pointer-events-none">
              <ListChecks className="w-2.5 h-2.5 text-primary/70 flex-shrink-0" />
              <span className="text-[10px] font-medium text-primary truncate max-w-[220px]">{taskContext.name}</span>
            </div>
          )}

          {/* Textarea area */}
          <div className={`px-3 pb-1 ${taskContext ? 'pt-1' : 'pt-3'}`}>
            <textarea
              ref={textareaRef}
              value={displayContent}
              onChange={(e) => {
                if (isOnboardingSendStep) return
                const val = e.target.value
                setContent(val)
                // Open slash-command menu only when the input is a plausible command prefix.
                // Short-circuits before any filter computation via maxCommandLen:
                //   • starts with "/"
                //   • no spaces or newlines (file paths, multi-line text are not commands)
                //   • at most as long as the longest known command
                const afterSlash = val.slice(1)
                const looksLikeCommand =
                  slashCommands.length > 0 &&
                  val.startsWith('/') &&
                  !afterSlash.includes(' ') &&
                  !afterSlash.includes('\n') &&
                  afterSlash.length <= maxCommandLen
                if (looksLikeCommand) {
                  setSlashMenuOpen(true)
                  setSlashSelectedIndex(0)
                  setMentionMenuOpen(false)
                } else {
                  setSlashMenuOpen(false)
                }

                // @ mention detection (P1 fix: track cursor position as state)
                const nextCursor = e.target.selectionStart ?? val.length
                setCursorPos(nextCursor)
                const nextMentionMatch = getMentionMatch(val, nextCursor)
                if (nextMentionMatch && mentionArtifacts.length > 0) {
                  setMentionMenuOpen(true)
                  setMentionSelectedIndex(0)
                } else {
                  setMentionMenuOpen(false)
                }
              }}
              onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder || t('Type a message, let DevX help you...')}
              disabled={isGenerating}
              readOnly={isOnboardingSendStep}
              rows={1}
              className={`w-full bg-transparent resize-none
                focus:outline-none text-foreground placeholder:text-muted-foreground/50
                disabled:cursor-not-allowed
                ${isOnboardingSendStep ? 'cursor-default' : ''}`}
              style={{ minHeight: `${textareaMinHeightPx}px`, maxHeight: `${textareaMaxHeightPx}px` }}
            />
          </div>

          {/* Bottom toolbar - always visible, industry standard layout */}
          <InputToolbar
            isGenerating={isGenerating}
            isOnboarding={isOnboardingSendStep}
            isAttachmentBusy={isAttachmentBusy}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={() => setThinkingEnabled(!thinkingEnabled)}
            aiBrowserEnabled={aiBrowserEnabled}
            onAIBrowserToggle={() => setAIBrowserEnabled(!aiBrowserEnabled)}
            showAttachMenu={showAttachMenu}
            onAttachMenuToggle={() => setShowAttachMenu(!showAttachMenu)}
            onImageClick={handleImageButtonClick}
            onWordClick={handleWordButtonClick}
            imageCount={images.length}
            maxImages={MAX_IMAGES}
            attachMenuRef={attachMenuRef}
            canSend={canSend}
            onSend={handleSend}
            onStop={onStop}
            sendKeyMode={sendKeyMode}
            speechMicVisible={showSpeechMic}
            speechMicBlockedOffline={micBlockedOffline}
            speechListening={speechListening}
            offlineSpeechStream={offlineSpeech.stream}
            onVoiceClick={handleVoiceInputClick}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Input Toolbar - Bottom action bar
 * Extracted as a separate component for maintainability and future extensibility
 *
 * Layout: [+attachment] ──────────────────── [⚛ thinking] [send]
 */
interface InputToolbarProps {
  isGenerating: boolean
  isOnboarding: boolean
  isAttachmentBusy: boolean
  thinkingEnabled: boolean
  onThinkingToggle: () => void
  aiBrowserEnabled: boolean
  onAIBrowserToggle: () => void
  showAttachMenu: boolean
  onAttachMenuToggle: () => void
  onImageClick: () => void
  onWordClick: () => void
  imageCount: number
  maxImages: number
  attachMenuRef: React.RefObject<HTMLDivElement | null>
  canSend: boolean
  onSend: () => void
  onStop: () => void
  sendKeyMode: 'enter' | 'ctrl-enter'
  speechMicVisible: boolean
  speechMicBlockedOffline: boolean
  speechListening: boolean
  offlineSpeechStream: MediaStream | null
  onVoiceClick: () => void
}

function InputToolbar({
  isGenerating,
  isOnboarding,
  isAttachmentBusy,
  thinkingEnabled,
  onThinkingToggle,
  aiBrowserEnabled,
  onAIBrowserToggle,
  showAttachMenu,
  onAttachMenuToggle,
  onImageClick,
  onWordClick,
  imageCount,
  maxImages,
  attachMenuRef,
  canSend,
  onSend,
  onStop,
  sendKeyMode,
  speechMicVisible,
  speechMicBlockedOffline,
  speechListening,
  offlineSpeechStream,
  onVoiceClick,
}: InputToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between px-2 pb-2 pt-1">
      {/* Left section: attachment button + thinking toggle */}
      <div className="flex items-center gap-1">
        {/* Attachment menu */}
        {!isGenerating && !isOnboarding && (
          <div className="relative" ref={attachMenuRef}>
            <button
              onClick={onAttachMenuToggle}
              disabled={isAttachmentBusy}
              className={`w-8 h-8 flex items-center justify-center rounded-lg
                transition-all duration-150
                ${showAttachMenu
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
                }
                ${isAttachmentBusy ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title={t('Add attachment')}
            >
              <Plus size={18} className={`transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`} />
            </button>

            {/* Attachment menu dropdown */}
            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-popover border border-border
                rounded-xl shadow-lg min-w-[200px] z-20 animate-fade-in">
                <button
                  type="button"
                  onClick={onImageClick}
                  disabled={imageCount >= maxImages || isAttachmentBusy}
                  className={`w-full px-3 py-2 flex items-center gap-3 text-sm
                    transition-colors duration-150
                    ${imageCount >= maxImages || isAttachmentBusy
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-foreground hover:bg-muted/50'
                    }
                  `}
                >
                  <ImagePlus size={16} className="text-muted-foreground" />
                  <span>{t('Add image')}</span>
                  {imageCount > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {imageCount}/{maxImages}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onWordClick}
                  disabled={isAttachmentBusy}
                  className={`w-full px-3 py-2 flex items-center gap-3 text-sm text-left
                    transition-colors duration-150
                    ${isAttachmentBusy
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-foreground hover:bg-muted/50'
                    }
                  `}
                >
                  <FileText size={16} className="text-muted-foreground shrink-0" />
                  <span>{t('Add Word')}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* AI Browser toggle */}
        {!isGenerating && !isOnboarding && (
          <button
            onClick={onAIBrowserToggle}
            className={`h-6 flex items-center gap-0.5 px-1.5 rounded-md
              transition-colors duration-200 relative
              ${aiBrowserEnabled
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
              }
            `}
            title={aiBrowserEnabled ? t('AI Browser enabled (click to disable)') : t('Enable AI Browser')}
          >
            <Globe size={11} className="shrink-0" />
            <span className="text-[10px] leading-none">{t('Web Control')}</span>
            {/* Active indicator dot */}
            {aiBrowserEnabled && (
              <span className="absolute top-0.5 right-0.5 w-[3px] h-[3px] bg-primary rounded-full" />
            )}
          </button>
        )}

        {/* Thinking mode toggle - always show full label, no expansion */}
        {!isGenerating && !isOnboarding && (
          <button
            onClick={onThinkingToggle}
            className={`h-6 flex items-center gap-0.5 px-1.5 rounded-md
              transition-colors duration-200
              ${thinkingEnabled
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
              }
            `}
            title={thinkingEnabled ? t('Disable Deep Thinking') : t('Enable Deep Thinking')}
          >
            <Atom size={11} className="shrink-0" />
            <span className="text-[10px] leading-none">{t('Deep Thinking')}</span>
          </button>
        )}
      </div>

      {/* Right section: voice level + mic + send */}
      <div className="flex items-center gap-1">
        {speechMicVisible && !isGenerating && !isOnboarding && (
          <div className="flex items-center gap-1.5 shrink-0" aria-live="polite">
            {speechListening && (
              <SpeechVolumeMeter
                className="shrink-0"
                stream={offlineSpeechStream}
              />
            )}
            <button
              type="button"
              onClick={onVoiceClick}
              disabled={isAttachmentBusy && !speechListening}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200
                ${speechListening
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/40 animate-pulse'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
                }
                ${isAttachmentBusy && !speechListening ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title={
                speechMicBlockedOffline
                  ? t('Configure offline speech in Settings → Advanced.')
                  : speechListening
                    ? t('Stop voice input')
                    : t('Start voice input')
              }
            >
              <Mic size={18} className="shrink-0" />
            </button>
          </div>
        )}
        {isGenerating ? (
          <button
            onClick={onStop}
            className="w-8 h-8 flex items-center justify-center
              bg-destructive/10 text-destructive rounded-lg
              hover:bg-destructive/20 active:bg-destructive/30
              transition-all duration-150"
            title={t('Stop generation (Esc)')}
          >
            <div className="w-3 h-3 border-2 border-current rounded-sm" />
          </button>
        ) : (
          <button
            data-onboarding="send-button"
            onClick={onSend}
            disabled={!canSend}
            className={`
              w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200
              ${canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95'
                : 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={
              sendKeyMode === 'ctrl-enter'
                ? (thinkingEnabled ? t('Send (Deep Thinking) — Ctrl+Enter') : t('Send — Ctrl+Enter'))
                : (thinkingEnabled ? t('Send (Deep Thinking) — Enter') : t('Send — Enter'))
            }
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
