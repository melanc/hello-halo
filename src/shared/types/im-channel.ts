/**
 * IM Channel Adapter — Channel-agnostic push interface
 *
 * Defines the contract that all IM channel adapters (WeCom Bot, Feishu Bot,
 * DingTalk Bot, etc.) must implement to support proactive message pushing.
 *
 * The runtime uses this interface to push messages without knowing which
 * IM platform is behind it. Each adapter handles protocol-specific details
 * (e.g., aibot_send_msg for WeCom) internally.
 *
 * Design principles:
 * - No protocol details — only text + target identifiers
 * - Markdown as the universal message format (adapters convert internally)
 * - Synchronous success/failure return (no retry logic — caller decides)
 */

// ============================================
// ImChannelAdapter
// ============================================

/**
 * Channel adapter interface for proactive message pushing.
 *
 * Implemented by each IM source adapter (WecomBotSource, FeishuBotSource, etc.)
 * alongside their existing EventSourceAdapter implementation.
 */
export interface ImChannelAdapter {
  /** Channel identifier matching InboundMessage.channel (e.g., 'wecom-bot') */
  readonly channel: string

  /**
   * Push a message proactively to a specific chat.
   *
   * Unlike replyToChat() (which requires a req_id from an inbound message),
   * this method can send messages at any time without a prior user message
   * in the current request cycle.
   *
   * @param chatId - Platform-side conversation ID
   * @param text - Message content (Markdown format)
   * @param chatType - Conversation type
   * @returns true if sent successfully, false otherwise
   */
  pushToChat(chatId: string, text: string, chatType: 'direct' | 'group'): boolean

  /**
   * Check if the underlying connection is available for sending.
   */
  isConnected(): boolean
}

// ============================================
// ImSessionRecord
// ============================================

/**
 * Persistent record of a known IM session.
 *
 * Created automatically when a user first messages the bot in a chat.
 * The `proactive` flag is toggled by the user in Halo's settings UI.
 */
export interface ImSessionRecord {
  /** Associated digital human (App) ID */
  appId: string
  /** Channel identifier: 'wecom-bot' | 'feishu-bot' | 'dingtalk-bot' | ... */
  channel: string
  /** Platform-side conversation ID */
  chatId: string
  /** Conversation type */
  chatType: 'direct' | 'group'
  /** Human-readable name for UI display (set once on first registration, never overwritten) */
  displayName: string
  /** User-assigned custom name — highest display priority */
  customName?: string
  /** Most recent message sender name */
  lastSender?: string
  /** Most recent message preview (truncated to 50 chars) */
  lastMessage?: string
  /** Whether proactive pushing is enabled (default: false) */
  proactive: boolean
  /** Last activity timestamp (epoch ms) */
  lastActiveAt: number
}
