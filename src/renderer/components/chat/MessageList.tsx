/**
 * Message List - Displays chat messages with streaming and thinking support
 * Layout: User message -> [Thinking Process above] -> [Assistant Reply]
 * Thinking process is always displayed ABOVE the assistant message (like ChatGPT/Cursor)
 *
 * Uses react-virtuoso for virtualized scrolling — only visible messages are in DOM.
 * This provides smooth performance even with 100+ messages containing thoughts/tool calls.
 *
 * Key Feature: StreamingBubble with scroll animation
 * When AI outputs text -> calls tool -> outputs more text:
 * - Old content smoothly scrolls up and out of view
 * - New content appears in place
 * - Creates a clean, focused reading experience
 *
 * @see docs/streaming-scroll-animation.md for detailed implementation notes
 */

import { useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { MessageItem } from './MessageItem'
import { ThoughtProcess } from './ThoughtProcess'
import { CollapsedThoughtProcess, LazyCollapsedThoughtProcess } from './CollapsedThoughtProcess'
import { CompactNotice } from './CompactNotice'
import { InterruptedBubble } from './InterruptedBubble'
import { StreamingBubble } from './StreamingBubble'
import { BrowserTaskCard, isBrowserTool } from '../tool/BrowserTaskCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { AnnounceFileChangesCard } from './AnnounceFileChangesCard'
import type { Message, Thought, CompactInfo, AgentErrorType, PendingQuestion, PendingFileChanges } from '../../types'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chat.store'

export interface MessageListProps {
  messages: Message[]
  streamingContent: string
  isGenerating: boolean
  isStreaming?: boolean  // True during token-level text streaming
  thoughts?: Thought[]
  isThinking?: boolean
  compactInfo?: CompactInfo | null
  error?: string | null  // Error message to display when generation fails
  errorType?: AgentErrorType | null  // Special error type for custom UI handling
  onContinue?: () => void  // Callback to continue after interrupt (for InterruptedBubble)
  isCompact?: boolean  // Compact mode when Canvas is open
  textBlockVersion?: number  // Increments on each new text block (for StreamingBubble reset)
  pendingQuestion?: PendingQuestion | null  // Active question from AskUserQuestion tool
  onAnswerQuestion?: (answers: Record<string, string>) => void  // Callback when user answers
  pendingFileChanges?: PendingFileChanges | null  // Pending file-change confirmation
  onConfirmFileChanges?: (confirmed: boolean) => void  // Callback when user confirms/cancels file changes
  onAtBottomStateChange?: (atBottom: boolean) => void  // Callback when at-bottom state changes
}

/** Handle exposed to parent for scroll control */
export interface MessageListHandle {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
  /** Virtuoso scroll root — for listeners (e.g. dismiss selection toolbar on scroll). */
  getScrollerElement: () => HTMLElement | null
}

/**
 * StreamingFooterContent — Isolated component for high-frequency streaming updates.
 * Reads volatile props from a ref to avoid rebuilding the parent Footer callback.
 * This prevents Virtuoso from unmounting/remounting Footer on every token.
 */
interface StreamingRevision {
  streamingContent: string
  isStreaming: boolean
  thoughts: Thought[]
  isThinking: boolean
  textBlockVersion: number
  streamingBrowserToolCalls: { id: string; name: string; status: 'running' | 'success'; input: any }[]
  pendingQuestion: PendingQuestion | null
  onAnswerQuestion?: (answers: Record<string, string>) => void
  pendingFileChanges: PendingFileChanges | null
  onConfirmFileChanges?: (confirmed: boolean) => void
}

function StreamingFooterContent({ revisionRef }: { revisionRef: React.RefObject<StreamingRevision> }) {
  // Subscribe to session changes so this component re-renders when thoughts/streaming update.
  // Data is read from the ref (always fresh); this selector just triggers the re-render.
  useChatStore(s => s.sessions.get(s.getCurrentSpaceState().currentConversationId ?? ''))

  const rev = revisionRef.current!
  return (
    <div className="flex justify-start animate-fade-in pb-4">
      <div className="w-[85%] relative">
        {/* Real-time thought process at top */}
        {(rev.thoughts.length > 0 || rev.isThinking) && (
          <ThoughtProcess thoughts={rev.thoughts} isThinking={rev.isThinking} />
        )}

        {/* Real-time browser task card - shows AI browser operations as they happen */}
        {rev.streamingBrowserToolCalls.length > 0 && (
          <div className="mb-4">
            <BrowserTaskCard
              browserToolCalls={rev.streamingBrowserToolCalls}
              isActive={rev.isThinking}
            />
          </div>
        )}

        {/* Streaming bubble with accumulated content and auto-scroll */}
        <StreamingBubble
          content={rev.streamingContent}
          isStreaming={rev.isStreaming}
          thoughts={rev.thoughts}
          textBlockVersion={rev.textBlockVersion}
        />

        {/* AskUserQuestion card - shown when AI needs user input */}
        {rev.pendingQuestion && rev.onAnswerQuestion && (
          <AskUserQuestionCard
            pendingQuestion={rev.pendingQuestion}
            onAnswer={rev.onAnswerQuestion}
          />
        )}

        {/* AnnounceFileChanges card - shown when agent wants to confirm file modifications */}
        {rev.pendingFileChanges && rev.onConfirmFileChanges && (
          <AnnounceFileChangesCard
            pendingFileChanges={rev.pendingFileChanges}
            onConfirm={rev.onConfirmFileChanges}
          />
        )}
      </div>
    </div>
  )
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList({
  messages,
  streamingContent,
  isGenerating,
  isStreaming = false,
  thoughts = [],
  isThinking = false,
  compactInfo = null,
  error = null,
  errorType = null,
  onContinue,
  isCompact = false,
  textBlockVersion = 0,
  pendingQuestion = null,
  onAnswerQuestion,
  pendingFileChanges = null,
  onConfirmFileChanges,
  onAtBottomStateChange,
}, ref) {
  const { t } = useTranslation()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // Native DOM scroll container — captured via Virtuoso's scrollerRef prop
  const scrollerRef = useRef<HTMLElement | null>(null)
  // Track at-bottom state in a ref (not state) to avoid re-renders on every scroll event
  const isAtBottomRef = useRef(true)
  // Track which messages had their thought panel opened by the user.
  // When loadMessageThoughts updates the store, the component tree switches from
  // LazyCollapsedThoughtProcess to CollapsedThoughtProcess — this ref ensures the
  // new CollapsedThoughtProcess mounts with defaultExpanded=true so the panel stays open.
  const expandedThoughtIds = useRef(new Set<string>())
  const { loadMessageThoughts, currentSpaceId, currentConversationId } = useChatStore(s => ({
    loadMessageThoughts: s.loadMessageThoughts,
    currentSpaceId: s.currentSpaceId,
    currentConversationId: s.getCurrentSpaceState().currentConversationId,
  }))

  // Expose scroll control to parent (ChatView)
  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number, behavior: ScrollBehavior = 'smooth') => {
      virtuosoRef.current?.scrollToIndex({ index, behavior, align: 'center' })
    },
    scrollToBottom: (behavior: ScrollBehavior = 'smooth') => {
      const el = scrollerRef.current
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior })
      }
    },
    getScrollerElement: () => scrollerRef.current,
  }), [])

  // Filter out empty assistant placeholder message during generation
  // (Backend adds empty assistant message as placeholder, we show streaming content instead)
  const displayMessages = useMemo(() => {
    if (isGenerating) {
      return messages.filter((msg, idx) => {
        const isLastMessage = idx === messages.length - 1
        const isEmptyAssistant = msg.role === 'assistant' && !msg.content
        return !(isLastMessage && isEmptyAssistant)
      })
    }
    return messages
  }, [messages, isGenerating])

  // Pre-compute cost map: index → previous assistant cost (O(n) once, then O(1) per lookup)
  // This avoids a useCallback dependency on displayMessages that would cascade to itemContent
  const previousCostMap = useMemo(() => {
    const map = new Map<number, number>()
    let lastCost = 0
    for (let i = 0; i < displayMessages.length; i++) {
      map.set(i, lastCost)
      const msg = displayMessages[i]
      if (msg.role === 'assistant' && msg.tokenUsage?.totalCostUsd) {
        lastCost = msg.tokenUsage.totalCostUsd
      }
    }
    return map
  }, [displayMessages])

  // Extract real-time browser tool calls from streaming thoughts
  // This enables BrowserTaskCard to show operations as they happen
  const streamingBrowserToolCalls = useMemo(() => {
    return thoughts
      .filter(t => t.type === 'tool_use' && t.toolName && isBrowserTool(t.toolName))
      .map(t => ({
        id: t.id,
        name: t.toolName!,
        // Determine status from merged toolResult (set by backend via agent:thought-delta)
        status: t.toolResult
          ? (t.toolResult.isError ? 'error' as const : 'success' as const)
          : 'running' as const,
        input: t.toolInput || {},
      }))
  }, [thoughts])

  // Track at-bottom state via native DOM scroll events (independent of Virtuoso).
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom
    onAtBottomStateChange?.(atBottom)
  }, [onAtBottomStateChange])

  /** Instantly snap scroll container to absolute bottom */
  const scrollToEnd = useCallback(() => {
    const el = scrollerRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  }, [])

  // --- Native DOM auto-scroll (replaces Virtuoso followOutput) ---

  // 1. Mount scroll: wait for Virtuoso to finish initial layout, then snap to bottom.
  useEffect(() => {
    const timer = setTimeout(scrollToEnd, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. Streaming scroll: follow content growth while AI is generating
  useEffect(() => {
    if (!isAtBottomRef.current || !isGenerating) return
    requestAnimationFrame(scrollToEnd)
  }, [streamingContent, thoughts.length, isThinking, isGenerating, pendingQuestion, scrollToEnd])

  // 3. New-message scroll: when user sends a message (displayMessages grows)
  const prevDisplayCountRef = useRef(displayMessages.length)
  useEffect(() => {
    const prev = prevDisplayCountRef.current
    prevDisplayCountRef.current = displayMessages.length
    if (displayMessages.length > prev && isAtBottomRef.current) {
      requestAnimationFrame(scrollToEnd)
    }
  }, [displayMessages.length, scrollToEnd])

  // Content width class — applied per-item so Virtuoso scroll container stays full-width
  // (keeps scrollbar at the window edge, not next to message bubbles)
  const contentWidthClass = isCompact ? 'max-w-full' : 'max-w-3xl mx-auto'

  // Render a single message item (called by Virtuoso)
  const itemContent = useCallback((index: number, message: Message) => {
    const previousCost = previousCostMap.get(index) ?? 0
    const hasInlineThoughts = Array.isArray(message.thoughts) && message.thoughts.length > 0
    const hasSeparatedThoughts = message.thoughts === null && !!message.thoughtsSummary

    // Show collapsed thoughts ABOVE assistant messages, in same container for consistent width
    if (message.role === 'assistant' && (hasInlineThoughts || hasSeparatedThoughts)) {
      return (
        <div className={`flex justify-start pb-4 ${contentWidthClass}`}>
          {/* Fixed width container - prevents width jumping when content changes */}
          <div className="w-[85%]">
            {/* Collapsed thought process above the message */}
            {hasInlineThoughts ? (
              <CollapsedThoughtProcess
                thoughts={message.thoughts as Thought[]}
                defaultExpanded={expandedThoughtIds.current.has(message.id)}
              />
            ) : (
              <LazyCollapsedThoughtProcess
                thoughtsSummary={message.thoughtsSummary!}
                onLoadThoughts={
                  currentSpaceId && currentConversationId
                    ? () => {
                        expandedThoughtIds.current.add(message.id)
                        return loadMessageThoughts(currentSpaceId, currentConversationId, message.id)
                      }
                    : () => Promise.resolve([])
                }
              />
            )}
            {/* Then the message itself (without embedded thoughts) */}
            <MessageItem message={message} previousCost={previousCost} hideThoughts isInContainer />
          </div>
        </div>
      )
    }
    return (
      <div className={`pb-4 ${contentWidthClass}`}>
        <MessageItem message={message} previousCost={previousCost} />
      </div>
    )
  }, [previousCostMap, currentSpaceId, currentConversationId, loadMessageThoughts, contentWidthClass])

  // Ref for onContinue — keeps Footer callback stable when parent re-renders
  const onContinueRef = useRef(onContinue)
  onContinueRef.current = onContinue

  // Streaming revision: combines all streaming state into a single object.
  // StreamingFooterContent reads this via ref (always fresh) and subscribes to
  // the store to trigger re-renders when streaming state changes.
  const streamingRevision = useMemo(() => {
    return { streamingContent, isStreaming, thoughts, isThinking, textBlockVersion,
             streamingBrowserToolCalls, pendingQuestion, onAnswerQuestion,
             pendingFileChanges, onConfirmFileChanges }
  }, [streamingContent, isStreaming, thoughts, isThinking, textBlockVersion,
      streamingBrowserToolCalls, pendingQuestion, onAnswerQuestion,
      pendingFileChanges, onConfirmFileChanges])
  const streamingRevisionRef = useRef(streamingRevision)
  streamingRevisionRef.current = streamingRevision

  // Footer: stable callback — only depends on low-frequency values
  // High-frequency streaming updates are handled by StreamingFooterContent internally
  const Footer = useCallback(() => {
    const hasFooterContent = isGenerating || (!isGenerating && error) || compactInfo
    if (!hasFooterContent) return <div className="pb-6" />

    return (
      <div className={contentWidthClass}>
        {/* Streaming area — isolated component reads from refs, re-renders independently */}
        {isGenerating && <StreamingFooterContent revisionRef={streamingRevisionRef} />}

        {/* Error message - shown when generation fails (not during generation) */}
        {/* Interrupted errors get special friendly UI, other errors show standard error bubble */}
        {!isGenerating && error && errorType === 'interrupted' && (
          <div className="pb-4">
            <InterruptedBubble error={error} onContinue={onContinueRef.current} />
          </div>
        )}
        {!isGenerating && error && errorType !== 'interrupted' && (
          <div className="flex justify-start animate-fade-in pb-4">
            <div className="w-[85%]">
              <div className="rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/30">
                <div className="flex items-center gap-2 text-destructive">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span className="text-sm font-medium">{t('Something went wrong')}</span>
                </div>
                <p className="mt-2 text-sm text-destructive/80">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Compact notice - shown when context was compressed (runtime notification) */}
        {compactInfo && (
          <div className="pb-4">
            <CompactNotice trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
          </div>
        )}

        {/* Bottom padding to match original py-6 spacing */}
        <div className="pb-6" />
      </div>
    )
  }, [
    isGenerating,
    error, errorType,
    compactInfo, t, contentWidthClass,
  ])

  // Top padding spacer — matches original py-6
  const Header = useCallback(() => <div className="pt-6" />, [])

  // Stable components object — avoids Virtuoso re-initializing on every render
  const components = useMemo(() => ({ Header, Footer }), [Header, Footer])

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={displayMessages}
      style={{ height: '100%' }}
      scrollerRef={(el) => { scrollerRef.current = el as HTMLElement }}
      initialTopMostItemIndex={displayMessages.length > 0 ? displayMessages.length - 1 : 0}
      defaultItemHeight={150}
      increaseViewportBy={800}
      atBottomThreshold={100}
      atBottomStateChange={handleAtBottomStateChange}
      itemContent={itemContent}
      components={components}
    />
  )
})
