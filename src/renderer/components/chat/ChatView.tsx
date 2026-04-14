/**
 * Chat View - Main chat interface
 * Uses session-based state for multi-conversation support
 * Supports onboarding mode with mock AI response
 * Features smart auto-scroll via react-virtuoso (stops when user reads history)
 *
 * Layout modes:
 * - Full width (isCompact=false): Centered content with max-width
 * - Compact mode (isCompact=true): Sidebar-style when Canvas is open
 */

import { useState, useCallback, useEffect, useRef, useMemo, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Check, FileText, ListChecks, Loader2, Pencil, Play, Plus, ScanText, Trash2 } from 'lucide-react'
import { useSpaceStore } from '../../stores/space.store'
import { useChatStore } from '../../stores/chat.store'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useAIBrowserStore } from '../../stores/ai-browser.store'
import { MessageList } from './MessageList'
import type { MessageListHandle } from './MessageList'
import { InputArea } from './InputArea'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { Sparkles } from '../icons/ToolIcons'
import {
  ONBOARDING_ARTIFACT_NAME,
  getOnboardingAiResponse,
  getOnboardingHtmlArtifact,
  getOnboardingPrompt,
} from '../onboarding/onboardingData'
import { api } from '../../api'
import type { ImageAttachment, Artifact } from '../../types'
import type { SlashCommandItem } from '../../types/slash-command'
import { useTranslation } from '../../i18n'
import { useTaskStore } from '../../stores/task.store'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import {
  extractLastAssistantPlanFromMessages,
  formatAppendTopLevelBreakdownSection,
  parseImplementationBreakdownTree,
  resolveChatExcerptsBucketDisplayTitle,
  flattenBreakdownSubtree,
  type BreakdownTreeNode,
} from '../../lib/parse-implementation-breakdown'
import { buildSubTaskImplementationPlanKickoffMessage } from '../../lib/workspace-task-messages'
import { loadKnowledgeBaseContextForTask } from '../../lib/knowledge-base-prompt-context'

/** Identify / Breakdown — default idle (light gray) */
const TASK_IDENTIFY_BREAKDOWN_IDLE =
  'border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200/75 dark:border-neutral-600 dark:bg-neutral-800/85 dark:text-neutral-100 dark:hover:bg-neutral-800'

/** After identify / breakdown (or while that action is running) — light blue */
const TASK_ACTION_DONE_SKY =
  'border-sky-300/80 bg-sky-100 text-sky-950 hover:bg-sky-200/90 dark:border-sky-500/45 dark:bg-sky-500/22 dark:text-sky-50 dark:hover:bg-sky-500/30'

/** Start implementation — after first click (light green) */
const TASK_START_IMPL_DONE =
  'border-emerald-400/45 bg-emerald-500/12 text-emerald-900 hover:bg-emerald-500/18 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100 dark:hover:bg-emerald-500/22'

/** Strings to try when replacing a top-level breakdown block in saved Markdown */
function buildBreakdownSubtaskFindVariants(node: BreakdownTreeNode): string[] {
  const title = node.title?.trim() ?? ''
  /** Parser caps detail with trailing "…"; strip so find matches full saved body prefix. */
  const detail = (node.detail?.trim() ?? '').replace(/\n…\s*$/, '').trim()
  const out: string[] = []
  const twoNl = [title, detail].filter(Boolean).join('\n\n')
  const oneNl = [title, detail].filter(Boolean).join('\n')
  if (twoNl) out.push(twoNl)
  if (oneNl && oneNl !== twoNl) out.push(oneNl)
  const topNum = title.match(/^(\d+(?:\.\d+)*)\.\s+(.+)$/)
  if (topNum && detail) {
    out.push(`${topNum[1]}. ${topNum[2]}\n\n${detail}`)
    out.push(`${topNum[1]}) ${topNum[2]}\n\n${detail}`)
    out.push(`${topNum[1]}. ${topNum[2]}\n${detail}`)
    out.push(`${topNum[1]}) ${topNum[2]}\n${detail}`)
  } else if (topNum && !detail) {
    out.push(`${topNum[1]}. ${topNum[2]}`)
    out.push(`${topNum[1]}) ${topNum[2]}`)
  }
  if (title && !/^\d/.test(title)) {
    const d = detail ? `\n\n${detail}` : ''
    out.push(`## ${title}${d}`.trim())
    out.push(`### ${title}${d}`.trim())
  }
  return [...new Set(out.filter((s) => s.length > 0))]
}

function BreakdownTreeList({
  nodes,
  depth,
  disabled,
  onStartTopLevel,
  onEditTopLevel,
  onDeleteTopLevel,
  implementationStartedTopIndices,
}: {
  nodes: BreakdownTreeNode[]
  depth: number
  disabled: boolean
  onStartTopLevel: (node: BreakdownTreeNode, topLevelIndex: number) => void
  onEditTopLevel: (node: BreakdownTreeNode) => void
  onDeleteTopLevel: (node: BreakdownTreeNode) => void
  implementationStartedTopIndices?: Set<number>
}) {
  const { t } = useTranslation()
  return (
    <ul
      className={
        depth === 0
          ? 'flex flex-col gap-2'
          : 'mt-2 space-y-2 border-l border-border/60 pl-2 sm:pl-3'
      }
    >
      {nodes.map((node, idx) => (
        <li
          key={`${depth}-${idx}-${node.title.slice(0, 48)}`}
          className="rounded-md border border-border/80 bg-background/50 p-2 sm:p-2.5"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="select-text break-words text-sm font-medium text-foreground">
                {depth === 0
                  ? resolveChatExcerptsBucketDisplayTitle(node.title, t('Chat excerpts from conversation'))
                  : node.title}
              </div>
              {node.detail ? (
                <p className="mt-1 select-text whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {node.detail}
                </p>
              ) : null}
            </div>
            {depth === 0 ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1 sm:gap-1.5">
                <button
                  type="button"
                  onClick={() => onEditTopLevel(node)}
                  disabled={disabled}
                  title={t('Edit')}
                  aria-label={t('Edit')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-50 ${TASK_IDENTIFY_BREAKDOWN_IDLE}`}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onStartTopLevel(node, idx)}
                  disabled={disabled}
                  title={t('Start implementation')}
                  aria-label={t('Start implementation')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    implementationStartedTopIndices?.has(idx) ? TASK_START_IMPL_DONE : TASK_IDENTIFY_BREAKDOWN_IDLE
                  }`}
                >
                  <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTopLevel(node)}
                  disabled={disabled}
                  title={t('Delete sub-task')}
                  aria-label={t('Delete sub-task')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
          {node.children.length > 0 ? (
            <BreakdownTreeList
              nodes={node.children}
              depth={depth + 1}
              disabled={disabled}
              onStartTopLevel={onStartTopLevel}
              onEditTopLevel={onEditTopLevel}
              onDeleteTopLevel={onDeleteTopLevel}
              implementationStartedTopIndices={implementationStartedTopIndices}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

interface ChatViewProps {
  isCompact?: boolean
  /** Taller bottom composer when a task is focused in the space */
  isTaskFocusComposer?: boolean
}

export function ChatView({ isCompact = false, isTaskFocusComposer = false }: ChatViewProps) {
  const { t } = useTranslation()
  const { showConfirm, DialogComponent } = useConfirmDialog()
  const { currentSpace } = useSpaceStore()
  const {
    getCurrentConversation,
    getCurrentConversationId,
    getCurrentSession,
    sessionInitInfo,
    sendMessage,
    stopGeneration,
    continueAfterInterrupt,
    answerQuestion,
    composerReferenceChips,
    removeComposerReferenceChip,
    clearComposerReferenceChips,
  } = useChatStore()
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const tasks = useTaskStore((s) => s.tasks)

  // Onboarding state
  const {
    isActive: isOnboarding,
    currentStep,
    nextStep,
    setMockAnimating,
    setMockThinking,
    isMockAnimating,
    isMockThinking
  } = useOnboardingStore()

  // Mock onboarding state
  const [mockUserMessage, setMockUserMessage] = useState<string | null>(null)
  const [mockAiResponse, setMockAiResponse] = useState<string | null>(null)
  const [mockStreamingContent, setMockStreamingContent] = useState<string>('')
  // Artifact list for @ mention suggestions in InputArea
  const [mentionArtifacts, setMentionArtifacts] = useState<Artifact[]>([])

  // Load artifacts for @ mention suggestions (depth=5 for deeper file references)
  useEffect(() => {
    if (!currentSpace?.id) {
      setMentionArtifacts([])
      return
    }
    let cancelled = false
    api.listArtifacts(currentSpace.id, 5).then(response => {
      if (!cancelled && response.success && response.data) {
        setMentionArtifacts(response.data as Artifact[])
      }
    }).catch(error => {
      if (!cancelled) console.error('[ChatView] Failed to load mention artifacts:', error)
    })
    return () => { cancelled = true }
  }, [currentSpace?.id])

  // Clear mock state when onboarding completes
  useEffect(() => {
    if (!isOnboarding) {
      setMockUserMessage(null)
      setMockAiResponse(null)
      setMockStreamingContent('')
    }
  }, [isOnboarding])

  // MessageList ref for scroll control (Virtuoso-based)
  const messageListRef = useRef<MessageListHandle>(null)

  // Scroll-to-bottom button visibility — driven by Virtuoso's atBottomStateChange
  const [showScrollButton, setShowScrollButton] = useState(false)
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setShowScrollButton(!atBottom)
  }, [])

  // Handle search result navigation - scroll to message and highlight search term
  // With Virtuoso, we first scroll the target message into view by index,
  // then apply DOM-based highlighting once it's rendered.
  const displayMessagesRef = useRef<{ id: string }[]>([])

  useEffect(() => {
    const handleNavigateToMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{ messageId: string; query: string }>
      const { messageId, query } = customEvent.detail

      console.log(`[ChatView] Attempting to navigate to message: ${messageId}`)

      // Remove previous highlights from all messages
      document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight')
      })
      document.querySelectorAll('.search-term-highlight').forEach(el => {
        const textNode = document.createTextNode(el.textContent || '')
        el.replaceWith(textNode)
      })

      // Find message index in displayMessages
      const messageIndex = displayMessagesRef.current.findIndex(m => m.id === messageId)
      if (messageIndex === -1) {
        console.warn(`[ChatView] Message not found in displayMessages for ID: ${messageId}`)
        return
      }

      // Scroll to the message via Virtuoso
      messageListRef.current?.scrollToIndex(messageIndex, 'smooth')

      // Wait for Virtuoso to render the item, then apply DOM highlighting
      const applyHighlight = (retries = 0) => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
        if (!messageElement) {
          if (retries < 10) {
            setTimeout(() => applyHighlight(retries + 1), 100)
          } else {
            console.warn(`[ChatView] Message element not found after scrollToIndex for ID: ${messageId}`)
          }
          return
        }

        console.log(`[ChatView] Found message element, highlighting`)

        // Add highlight animation
        messageElement.classList.add('search-highlight')
        setTimeout(() => {
          messageElement.classList.remove('search-highlight')
        }, 2000)

        // Highlight search terms in the message (simple text highlight)
        const contentElement = messageElement.querySelector('[data-message-content]')
        if (contentElement && query) {
          try {
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
            const originalHTML = contentElement.innerHTML

            if (!originalHTML.includes('search-term-highlight')) {
              contentElement.innerHTML = originalHTML.replace(
                regex,
                '<mark class="search-term-highlight bg-yellow-400/30 font-semibold rounded px-0.5">$1</mark>'
              )
              console.log(`[ChatView] Highlighted search term: "${query}"`)
            }
          } catch (error) {
            console.error(`[ChatView] Error highlighting search term:`, error)
          }
        }
      }

      // Small delay to allow Virtuoso to scroll and render
      setTimeout(() => applyHighlight(), 150)
    }

    // Clear all search highlights when requested
    const handleClearHighlights = () => {
      console.log(`[ChatView] Clearing all search highlights`)
      document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight')
      })
      document.querySelectorAll('.search-term-highlight').forEach(el => {
        const textNode = document.createTextNode(el.textContent || '')
        el.replaceWith(textNode)
      })
    }

    window.addEventListener('search:navigate-to-message', handleNavigateToMessage)
    window.addEventListener('search:clear-highlights', handleClearHighlights)
    return () => {
      window.removeEventListener('search:navigate-to-message', handleNavigateToMessage)
      window.removeEventListener('search:clear-highlights', handleClearHighlights)
    }
  }, [])

  // Get current conversation and its session state
  const currentConversation = getCurrentConversation()
  const currentConversationId = getCurrentConversationId()
  const { isLoadingConversation } = useChatStore()
  const session = getCurrentSession()
  const { isGenerating, streamingContent, isStreaming, thoughts, isThinking, compactInfo, error, errorType, textBlockVersion, pendingQuestion } = session

  // Build the slash-command list for the autocomplete menu.
  // Only reads from SDK slash_commands array.
  // Commands are categorized as 'skill' if they appear in the skills array, otherwise 'builtin'.
  const slashCommands = useMemo<SlashCommandItem[]>(() => {
    const conversationId = getCurrentConversationId()
    const initInfo = conversationId ? sessionInitInfo.get(conversationId) : null

    const items: SlashCommandItem[] = []
    const itemsByCommand = new Map<string, SlashCommandItem>()

    const addItem = (item: SlashCommandItem) => {
      if (!itemsByCommand.has(item.command)) {
        itemsByCommand.set(item.command, item)
        items.push(item)
      }
    }

    // SDK slash_commands - categorize based on skills array
    if (initInfo?.slashCommands) {
      const skillsSet = new Set(initInfo.skills || [])

      initInfo.slashCommands.forEach((cmd) => {
        const category = skillsSet.has(cmd) ? 'skill' : 'builtin'
        addItem({
          id: `${category}-${cmd}`,
          command: `/${cmd}`,
          label: cmd,
          category,
        })
      })
    }

    return items
  }, [sessionInitInfo, getCurrentConversationId])

  const onboardingPrompt = getOnboardingPrompt(t)
  const onboardingResponse = getOnboardingAiResponse(t)
  const onboardingHtml = getOnboardingHtmlArtifact(t)

  // Handle mock onboarding send
  const handleOnboardingSend = useCallback(async () => {
    if (!currentSpace) return

    // Step 1: Show user message immediately
    setMockUserMessage(onboardingPrompt)

    // Step 2: Start "thinking" phase (2.5 seconds) - no spotlight during this time
    setMockThinking(true)
    setMockAnimating(true)
    await new Promise(resolve => setTimeout(resolve, 2000))
    setMockThinking(false)

    // Step 3: Stream mock AI response
    const response = onboardingResponse
    for (let i = 0; i <= response.length; i++) {
      setMockStreamingContent(response.slice(0, i))
      await new Promise(resolve => setTimeout(resolve, 15))
    }

    // Step 4: Complete response
    setMockAiResponse(response)
    setMockStreamingContent('')

    // Step 5: Write the actual HTML file to disk BEFORE stopping animation
    // This ensures the file exists when ArtifactRail tries to load it
    try {
      await api.writeOnboardingArtifact(
        currentSpace.id,
        ONBOARDING_ARTIFACT_NAME,
        onboardingHtml
      )

      // Also save the conversation to disk
      await api.saveOnboardingConversation(currentSpace.id, onboardingPrompt, onboardingResponse)

      // Small delay to ensure file system has synced
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (err) {
      console.error('Failed to write onboarding artifact:', err)
    }

    // Step 6: Animation done
    // Note: Don't call nextStep() here - it's already called by Spotlight's handleHoleClick
    // We just need to stop the animation so the Spotlight can show the artifact
    setMockAnimating(false)
  }, [currentSpace, onboardingHtml, onboardingPrompt, onboardingResponse, setMockAnimating, setMockThinking])

  // AI Browser state
  const { enabled: aiBrowserEnabled } = useAIBrowserStore()

  // Handle send (with optional images for multi-modal messages, optional thinking mode)
  const handleSend = async (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean) => {
    // In onboarding mode, intercept and play mock response
    if (isOnboarding && currentStep === 'send-message') {
      handleOnboardingSend()
      return
    }

    // Can send if has text OR has images
    if ((!content.trim() && (!images || images.length === 0)) || isGenerating) return

    // Pass both AI Browser and thinking state to sendMessage
    await sendMessage(content, images, aiBrowserEnabled, thinkingEnabled)
  }

  // Handle stop - stops the current conversation's generation
  const handleStop = async () => {
    if (currentConversation) {
      await stopGeneration(currentConversation.id)
    }
  }

  // Combine real messages with mock onboarding messages
  const realMessages = currentConversation?.messages || []
  const displayMessages = mockUserMessage
    ? [
        ...realMessages,
        { id: 'onboarding-user', role: 'user' as const, content: mockUserMessage, timestamp: new Date().toISOString() },
        ...(mockAiResponse
          ? [{ id: 'onboarding-ai', role: 'assistant' as const, content: mockAiResponse, timestamp: new Date().toISOString() }]
          : [])
      ]
    : realMessages

  // Keep displayMessagesRef in sync for search navigation
  displayMessagesRef.current = displayMessages

  const displayStreamingContent = mockStreamingContent || streamingContent
  const displayIsGenerating = isMockAnimating || isGenerating
  const displayIsThinking = isMockThinking || isThinking
  const displayIsStreaming = isStreaming  // Only real streaming (not mock)
  const hasMessages = displayMessages.length > 0 || displayStreamingContent || displayIsThinking
  const activeTask = useMemo(() => {
    if (!activeTaskId || !currentSpace || !currentConversationId) return null
    const task = tasks.find((x) => x.id === activeTaskId)
    if (!task) return null
    if (task.spaceId !== currentSpace.id) return null
    if (task.conversationId !== currentConversationId) return null
    return task
  }, [activeTaskId, currentConversationId, currentSpace, tasks])

  const breakdownPlanSource = useMemo(() => {
    if (!activeTask?.requirementBreakdownUsed) return ''
    const stored = activeTask.breakdownPlanMarkdown?.trim()
    if (stored) return stored
    return extractLastAssistantPlanFromMessages(realMessages)
  }, [activeTask, realMessages])

  const breakdownTaskTree = useMemo(() => {
    if (!breakdownPlanSource) return []
    return parseImplementationBreakdownTree(breakdownPlanSource)
  }, [breakdownPlanSource])

  const requirementPreview = useMemo(() => {
    const content =
      activeTask?.requirementDocContent?.trim() || activeTask?.requirementDescription?.trim() || ''
    if (!content) return ''
    return content.length > 260 ? `${content.slice(0, 260)}...` : content
  }, [activeTask?.requirementDocContent, activeTask?.requirementDescription])

  const requirementContext = useMemo(() => {
    if (!activeTask) return ''
    const sections: string[] = []
    if (activeTask.requirementDocName?.trim() && activeTask.requirementDocContent?.trim()) {
      sections.push(t('Requirement document name: {{name}}', { name: activeTask.requirementDocName }))
      sections.push(activeTask.requirementDocContent)
    }
    if (activeTask.requirementDescription?.trim()) {
      sections.push(t('Requirement description'))
      sections.push(activeTask.requirementDescription.trim())
    }
    return sections.join('\n\n')
  }, [activeTask, t])

  const saveIdentifiedRequirements = useTaskStore((s) => s.saveIdentifiedRequirements)
  const completeRequirementBreakdown = useTaskStore((s) => s.completeRequirementBreakdown)
  const replaceBreakdownPlanExcerpt = useTaskStore((s) => s.replaceBreakdownPlanExcerpt)
  const appendBreakdownPlanSection = useTaskStore((s) => s.appendBreakdownPlanSection)
  const appendConversationExcerptToBreakdownPlan = useTaskStore((s) => s.appendConversationExcerptToBreakdownPlan)

  const conversationMessagesRef = useRef<HTMLDivElement>(null)
  const addToTaskToolbarRef = useRef<HTMLDivElement>(null)
  const [addToTaskPopover, setAddToTaskPopover] = useState<{
    top: number
    left: number
    text: string
  } | null>(null)
  const [subtasksPanelCollapsed, setSubtasksPanelCollapsed] = useState(false)
  const [implementationKickoffTopIndices, setImplementationKickoffTopIndices] = useState<Set<number>>(
    () => new Set()
  )
  const [editSubtaskContext, setEditSubtaskContext] = useState<BreakdownTreeNode | null>(null)
  const [editSubtaskDraft, setEditSubtaskDraft] = useState('')
  const [editSubtaskError, setEditSubtaskError] = useState<string | null>(null)
  const [addSubtaskOpen, setAddSubtaskOpen] = useState(false)
  const [addSubtaskTitle, setAddSubtaskTitle] = useState('')
  const [addSubtaskDetail, setAddSubtaskDetail] = useState('')
  const [addSubtaskError, setAddSubtaskError] = useState<string | null>(null)

  const pendingRequirementActionRef = useRef<{
    kind: 'identify' | 'breakdown'
    conversationId: string
    taskId: string
  } | null>(null)
  const prevIsGeneratingRef = useRef(false)
  const [requirementActionLoading, setRequirementActionLoading] = useState<'identify' | 'breakdown' | null>(
    null
  )

  const handleRequirementIdentify = useCallback(async () => {
    if (!activeTask || isGenerating || requirementActionLoading) return
    const cid = getCurrentConversationId()
    if (!cid) return
    pendingRequirementActionRef.current = {
      kind: 'identify',
      conversationId: cid,
      taskId: activeTask.id,
    }
    setRequirementActionLoading('identify')
    const kbMd = await loadKnowledgeBaseContextForTask(activeTask)
    const kbAppend =
      kbMd.trim().length > 0
        ? [
            '',
            t('--- Linked knowledge base (Markdown excerpts, for business/architecture context) ---'),
            '',
            kbMd,
          ]
        : []
    const prompt = [
      t('Please analyze the requirement document below and output structured requirement points using exactly the following 9 Markdown sections.'),
      t('Every section is required. If information is missing from the document, record it in section 8 (open questions) — do NOT fill in guesses.'),
      '',
      '## 一、需求概览',
      t('Goals, background, and scope (business lines, supported platforms, course modes).'),
      '',
      '## 二、功能模块拆解',
      t('Minimum development units. Mark each as 【必须】(required) or 【可选】(optional).'),
      '',
      '## 三、业务规则清单',
      t('Numbered rules (BR-01, BR-02…). Each includes trigger condition and exceptions.'),
      '',
      '## 四、端/平台覆盖矩阵',
      t('Table: each feature × each platform/client. Use ✅ ❌ ❓ per cell.'),
      '',
      '## 五、边界 Case & 异常流程',
      t('Data anomalies, state anomalies, compatibility issues, operation conflicts.'),
      '',
      '## 六、依赖项',
      t('Cross-team dependencies. Mark whether each is blocking.'),
      '',
      '## 七、风险点',
      t('Numbered risks (R-01, R-02…) with suggested mitigation.'),
      '',
      '## 八、待确认问题列表',
      t('All information gaps found in the document. Numbered, no self-completion.'),
      '',
      '## 九、开发任务建议清单',
      t('TASK-01, TASK-02… format. Each includes: involved client/platform, task content, acceptance criteria.'),
      '',
      requirementContext,
      ...kbAppend,
    ].join('\n')
    await handleSend(prompt)
    const sessionAfter = useChatStore.getState().sessions.get(cid)
    if (!sessionAfter?.isGenerating) {
      pendingRequirementActionRef.current = null
      setRequirementActionLoading(null)
    }
  }, [
    activeTask,
    getCurrentConversationId,
    handleSend,
    isGenerating,
    requirementActionLoading,
    requirementContext,
    t,
  ])

  const handleTaskBreakdown = useCallback(async () => {
    if (!activeTask || isGenerating || requirementActionLoading) return
    const cid = getCurrentConversationId()
    if (!cid) return
    pendingRequirementActionRef.current = {
      kind: 'breakdown',
      conversationId: cid,
      taskId: activeTask.id,
    }
    setRequirementActionLoading('breakdown')
    const kbMd = await loadKnowledgeBaseContextForTask(activeTask)
    const kbAppend =
      kbMd.trim().length > 0
        ? [
            '',
            t('--- Linked knowledge base (Markdown excerpts, for business/architecture context) ---'),
            '',
            kbMd,
          ]
        : []
    const prompt = [
      t('Break down implementation tasks based on the requirement document.'),
      t('For each requirement, list impacted projects, interfaces to modify, and interfaces to create.'),
      t('Use structured Markdown sections so engineers can execute directly.'),
      t('Use one Markdown "## " heading per implementation sub-task so the UI can list actions for each item.'),
      t('Number tasks as "1.", "2." for top-level items and "1.1", "1.2" for nested sub-tasks under each top-level item.'),
      '',
      requirementContext,
      ...kbAppend,
    ].join('\n')
    await handleSend(prompt)
    const sessionAfter = useChatStore.getState().sessions.get(cid)
    if (!sessionAfter?.isGenerating) {
      pendingRequirementActionRef.current = null
      setRequirementActionLoading(null)
    }
  }, [
    activeTask,
    getCurrentConversationId,
    handleSend,
    isGenerating,
    requirementActionLoading,
    requirementContext,
    t,
  ])

  const onRequirementIdentifyButtonClick = useCallback(async () => {
    if (isGenerating || requirementActionLoading !== null || !activeTask) return
    if (activeTask.requirementIdentifyUsed) {
      const ok = await showConfirm({
        title: t('Need to identify requirements again?'),
        confirmLabel: t('Confirm'),
        cancelLabel: t('Cancel'),
        variant: 'default',
      })
      if (!ok) return
    }
    void handleRequirementIdentify()
  }, [
    activeTask,
    handleRequirementIdentify,
    isGenerating,
    requirementActionLoading,
    showConfirm,
    t,
  ])

  const onRequirementBreakdownButtonClick = useCallback(async () => {
    if (isGenerating || requirementActionLoading !== null || !activeTask) return
    if (activeTask.requirementBreakdownUsed) {
      const ok = await showConfirm({
        title: t('Need to break down tasks again?'),
        confirmLabel: t('Confirm'),
        cancelLabel: t('Cancel'),
        variant: 'default',
      })
      if (!ok) return
    }
    void handleTaskBreakdown()
  }, [
    activeTask,
    handleTaskBreakdown,
    isGenerating,
    requirementActionLoading,
    showConfirm,
    t,
  ])

  useEffect(() => {
    setSubtasksPanelCollapsed(false)
    setImplementationKickoffTopIndices(new Set())
  }, [activeTaskId])

  useEffect(() => {
    if (!addToTaskPopover) return
    const scroller = messageListRef.current?.getScrollerElement?.() ?? null
    const onScroll = () => setAddToTaskPopover(null)
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    const onDocMouseDown = (ev: globalThis.MouseEvent) => {
      const node = ev.target as Node
      if (addToTaskToolbarRef.current?.contains(node)) return
      setAddToTaskPopover(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      scroller?.removeEventListener('scroll', onScroll)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [addToTaskPopover])

  const handleConversationMouseUp = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      if (!activeTask?.id || isGenerating || requirementActionLoading !== null) return
      const root = conversationMessagesRef.current
      if (!root) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount < 1) return
      const a = sel.anchorNode
      const f = sel.focusNode
      if (!a || !f) return
      if (!root.contains(a) || !root.contains(f)) return
      const raw = sel.toString().trim()
      if (raw.length < 2 || raw.length > 8000) return
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const centerX = rect.left + rect.width / 2
      const pad = 8
      const halfApprox = 96
      const left = Math.min(
        window.innerWidth - pad - halfApprox,
        Math.max(pad + halfApprox, centerX)
      )
      const top = Math.min(window.innerHeight - 52, rect.bottom + 8)
      setAddToTaskPopover({ top, left, text: raw })
    },
    [activeTask?.id, isGenerating, requirementActionLoading]
  )

  const handleAddSelectionToTask = useCallback(() => {
    if (!activeTask?.id || !addToTaskPopover?.text.trim()) return
    appendConversationExcerptToBreakdownPlan(activeTask.id, addToTaskPopover.text.trim())
    setAddToTaskPopover(null)
    window.getSelection()?.removeAllRanges()
  }, [activeTask?.id, addToTaskPopover, appendConversationExcerptToBreakdownPlan])

  const openAddSubtask = useCallback(() => {
    setAddSubtaskTitle('')
    setAddSubtaskDetail('')
    setAddSubtaskError(null)
    setAddSubtaskOpen(true)
  }, [])

  const applyAddSubtask = useCallback(() => {
    if (!activeTask?.id) return
    const title = addSubtaskTitle.trim()
    if (!title) {
      setAddSubtaskError(t('Sub-task title is required'))
      return
    }
    const block = formatAppendTopLevelBreakdownSection(
      activeTask.breakdownPlanMarkdown,
      title,
      addSubtaskDetail
    )
    if (!block.trim()) {
      setAddSubtaskError(t('Sub-task title is required'))
      return
    }
    appendBreakdownPlanSection(activeTask.id, block)
    setAddSubtaskOpen(false)
    setAddSubtaskError(null)
  }, [activeTask, addSubtaskDetail, addSubtaskTitle, appendBreakdownPlanSection, t])

  const openEditSubtask = useCallback((node: BreakdownTreeNode) => {
    const block = [node.title, node.detail].filter((x) => x?.trim()).join('\n\n')
    setEditSubtaskDraft(block)
    setEditSubtaskContext(node)
    setEditSubtaskError(null)
  }, [])

  const applyEditSubtask = useCallback(() => {
    if (!activeTask?.id || !editSubtaskContext) return
    const newText = editSubtaskDraft.trim()
    const variants = buildBreakdownSubtaskFindVariants(editSubtaskContext)
    let ok = false
    for (const v of variants) {
      const needle = v.trim()
      if (!needle) continue
      const md =
        useTaskStore.getState().tasks.find((x) => x.id === activeTask.id)?.breakdownPlanMarkdown ?? ''
      if (!md.includes(needle)) continue
      if (replaceBreakdownPlanExcerpt(activeTask.id, needle, newText)) {
        ok = true
        break
      }
    }
    if (!ok) {
      setEditSubtaskError(
        t(
          'Could not locate this sub-task in the saved breakdown. Re-run break down tasks or edit the item manually.'
        )
      )
      return
    }
    setEditSubtaskContext(null)
    setEditSubtaskError(null)
  }, [activeTask?.id, editSubtaskContext, editSubtaskDraft, replaceBreakdownPlanExcerpt, t])

  const handleDeleteSubtask = useCallback(
    async (node: BreakdownTreeNode) => {
      if (!activeTask?.id) return
      const confirmed = await showConfirm({
        title: t('Remove this sub-task from the saved breakdown?'),
        message: t('This removes the block from the saved plan. You can run break down tasks again to regenerate the list.'),
        confirmLabel: t('Delete'),
        cancelLabel: t('Cancel'),
        variant: 'danger',
      })
      if (!confirmed) return
      const variants = buildBreakdownSubtaskFindVariants(node)
      let ok = false
      for (const v of variants) {
        const needle = v.trim()
        if (!needle) continue
        const md =
          useTaskStore.getState().tasks.find((x) => x.id === activeTask.id)?.breakdownPlanMarkdown ?? ''
        if (!md.includes(needle)) continue
        if (replaceBreakdownPlanExcerpt(activeTask.id, needle, '')) {
          ok = true
          break
        }
      }
      if (!ok) {
        await showConfirm({
          title: t('Could not remove sub-task'),
          message: t(
            'Could not locate this sub-task in the saved breakdown. Re-run break down tasks or edit the item manually.'
          ),
          confirmLabel: t('OK'),
          cancelLabel: t('Cancel'),
          variant: 'default',
        })
        return
      }
      setImplementationKickoffTopIndices(new Set())
    },
    [activeTask?.id, replaceBreakdownPlanExcerpt, showConfirm, t]
  )

  const handleStartBreakdownNode = useCallback(
    async (node: BreakdownTreeNode, topLevelIndex: number) => {
      if (!activeTask?.requirementBreakdownUsed) return
      const cid = getCurrentConversationId()
      if (!cid || cid !== activeTask.conversationId) return
      const sess = useChatStore.getState().getSession(cid)
      if (sess.isGenerating) {
        const proceed = await showConfirm({
          title: t('The assistant is still responding. Send the implementation plan request anyway?'),
          confirmLabel: t('Confirm'),
          cancelLabel: t('Cancel'),
          variant: 'default',
        })
        if (!proceed) return
      }
      clearComposerReferenceChips()
      setImplementationKickoffTopIndices((prev) => new Set(prev).add(topLevelIndex))
      const subRef = { title: node.title, detail: flattenBreakdownSubtree(node) }
      await sendMessage(
        buildSubTaskImplementationPlanKickoffMessage(activeTask, subRef, t),
        undefined,
        aiBrowserEnabled,
        undefined
      )
    },
    [
      activeTask,
      aiBrowserEnabled,
      clearComposerReferenceChips,
      getCurrentConversationId,
      sendMessage,
      showConfirm,
      t,
    ]
  )

  // After agent run ends, mark "continue" state only on success (not stop / error).
  // Delay lets interrupted errors arrive after agent:complete (see chat.store).
  useEffect(() => {
    const pending = pendingRequirementActionRef.current
    const cid = currentConversationId

    if (pending && cid && pending.conversationId !== cid) {
      pendingRequirementActionRef.current = null
      setRequirementActionLoading(null)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const pendingNow = pendingRequirementActionRef.current

    if (
      pendingNow &&
      cid === pendingNow.conversationId &&
      prevIsGeneratingRef.current === true &&
      isGenerating === false
    ) {
      const snapshot = { ...pendingNow }
      pendingRequirementActionRef.current = null
      setRequirementActionLoading(null)

      timer = window.setTimeout(() => {
        const s = useChatStore.getState().sessions.get(snapshot.conversationId)
        if (!s) return
        if (s.errorType === 'interrupted' || s.error) return
        if (snapshot.kind === 'identify') {
          const conv = useChatStore.getState().getCachedConversation(snapshot.conversationId)
          const messages = conv?.messages ?? []
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
          const identified = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
          saveIdentifiedRequirements(snapshot.taskId, identified)
        } else {
          const conv = useChatStore.getState().getCachedConversation(snapshot.conversationId)
          const messages = conv?.messages ?? []
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
          const plan = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
          completeRequirementBreakdown(snapshot.taskId, plan)
        }
      }, 400)
    }

    prevIsGeneratingRef.current = isGenerating
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [
    isGenerating,
    currentConversationId,
    completeRequirementBreakdown,
    saveIdentifiedRequirements,
  ])

  // Track previous compact state for smooth transitions
  const prevCompactRef = useRef(isCompact)
  const isTransitioningLayout = prevCompactRef.current !== isCompact

  useEffect(() => {
    prevCompactRef.current = isCompact
  }, [isCompact])

  return (
    <div
      className={`
        flex-1 flex flex-col h-full text-[12px]
        transition-[padding] duration-300 ease-out
        ${isCompact ? 'bg-background/50' : 'bg-background'}
      `}
    >
      {/* Task header (shrink) + messages (flex-1 min-h-0) so long breakdown lists do not hide chat */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`flex min-h-0 flex-1 flex-col ${isCompact ? 'px-3' : 'px-4'}`}>
          <div className="relative min-h-0 flex-1">
            {isLoadingConversation ? (
              <LoadingState />
            ) : !hasMessages ? (
              <EmptyState isTemp={currentSpace?.isTemp || false} isCompact={isCompact} />
            ) : (
              <div
                ref={conversationMessagesRef}
                className="h-full min-h-0"
                onMouseUp={handleConversationMouseUp}
              >
                <MessageList
                  key={currentConversation?.id ?? 'empty'}
                  ref={messageListRef}
                  messages={displayMessages}
                  streamingContent={displayStreamingContent}
                  isGenerating={displayIsGenerating}
                  isStreaming={displayIsStreaming}
                  thoughts={thoughts}
                  isThinking={displayIsThinking}
                  compactInfo={compactInfo}
                  error={error}
                  errorType={errorType}
                  onContinue={
                    currentConversation ? () => continueAfterInterrupt(currentConversation.id) : undefined
                  }
                  isCompact={isCompact}
                  textBlockVersion={textBlockVersion}
                  pendingQuestion={pendingQuestion}
                  onAnswerQuestion={
                    currentConversation
                      ? (answers) => answerQuestion(currentConversation.id, answers)
                      : undefined
                  }
                  onAtBottomStateChange={handleAtBottomStateChange}
                />
              </div>
            )}
            <ScrollToBottomButton
              visible={showScrollButton && hasMessages}
              onClick={() => messageListRef.current?.scrollToBottom('auto')}
            />
          </div>
        </div>
      </div>

      {/* Input area */}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        placeholder={isCompact ? t('Continue conversation...') : (currentSpace?.isTemp ? t('Say something to DevX...') : t('Continue conversation...'))}
        isCompact={isCompact}
        isTaskFocusComposer={isTaskFocusComposer}
        slashCommands={slashCommands}
        mentionArtifacts={mentionArtifacts}
        composerReferenceChips={composerReferenceChips}
        onRemoveComposerReferenceChip={removeComposerReferenceChip}
        clearComposerReferenceChips={clearComposerReferenceChips}
      />
      {addToTaskPopover ? (
        <div
          ref={addToTaskToolbarRef}
          role="toolbar"
          aria-label={t('Add to task')}
          className="pointer-events-auto fixed z-[70]"
          style={{
            top: addToTaskPopover.top,
            left: addToTaskPopover.left,
            transform: 'translateX(-50%)',
          }}
        >
          <button
            type="button"
            onClick={() => handleAddSelectionToTask()}
            className="rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md btn-primary"
          >
            {t('Add to task')}
          </button>
        </div>
      ) : null}
      {editSubtaskContext ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-subtask-title"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 id="edit-subtask-title" className="mb-3 text-sm font-medium text-foreground">
              {t('Edit sub-task')}
            </h3>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="edit-subtask-textarea">
              {t('Sub-task text (title and body, Markdown)')}
            </label>
            <textarea
              id="edit-subtask-textarea"
              value={editSubtaskDraft}
              onChange={(e) => setEditSubtaskDraft(e.target.value)}
              rows={12}
              className="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            {editSubtaskError ? <p className="mt-2 text-xs text-destructive">{editSubtaskError}</p> : null}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setEditSubtaskContext(null)
                  setEditSubtaskError(null)
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                {t('Cancel')}
              </button>
              <button
                type="button"
                onClick={() => applyEditSubtask()}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground btn-primary"
              >
                {t('Save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {addSubtaskOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-subtask-title"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 id="add-subtask-title" className="mb-3 text-sm font-medium text-foreground">
              {t('Add sub-task')}
            </h3>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="add-subtask-title-input">
              {t('Sub-task title')}
            </label>
            <input
              id="add-subtask-title-input"
              type="text"
              value={addSubtaskTitle}
              onChange={(e) => {
                setAddSubtaskTitle(e.target.value)
                setAddSubtaskError(null)
              }}
              className="mb-3 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              autoFocus
            />
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="add-subtask-detail-textarea">
              {t('Sub-task description (optional)')}
            </label>
            <textarea
              id="add-subtask-detail-textarea"
              value={addSubtaskDetail}
              onChange={(e) => setAddSubtaskDetail(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            {addSubtaskError ? <p className="mt-2 text-xs text-destructive">{addSubtaskError}</p> : null}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setAddSubtaskOpen(false)
                  setAddSubtaskError(null)
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                {t('Cancel')}
              </button>
              <button
                type="button"
                onClick={() => applyAddSubtask()}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground btn-primary"
              >
                {t('Add')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {DialogComponent}
    </div>
  )
}

// Loading state component
function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      <p className="mt-3 text-sm text-muted-foreground">{t('Loading conversation...')}</p>
    </div>
  )
}

// Empty state component - adapts to compact mode
function EmptyState({ isTemp, isCompact = false }: { isTemp: boolean; isCompact?: boolean }) {
  const { t } = useTranslation()
  // Compact mode shows minimal UI
  if (isCompact) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <Sparkles className="w-8 h-8 text-primary/70" />
        <p className="mt-4 text-sm text-muted-foreground">
          {t('Continue the conversation here')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      {/* Icon */}
      <Sparkles className="w-12 h-12 text-primary" />

      {/* Title - concise and warm */}
      <h2 className="mt-6 text-xl font-medium">
        {t('DevX')}
      </h2>
      <p className="mt-2 text-muted-foreground">
        {t('Not just chat, help you get things done')}
      </p>

      {/* Powered by badge - simplified */}
      <div className="mt-8 px-3 py-1.5 rounded-full border border-border">
        <span className="text-xs text-muted-foreground">
          Powered by Claude Code
        </span>
      </div>
    </div>
  )
}
