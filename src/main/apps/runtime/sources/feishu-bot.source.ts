/**
 * apps/runtime/sources -- FeishuBotSource
 *
 * Event source adapter that uses Feishu WebSocket long-connection mode
 * (长连接推模式) via the official @larksuiteoapi/node-sdk WSClient.
 *
 * Inbound messages are routed to a configured DevX conversation
 * (main session or task conversation) instead of digital humans.
 *
 * The SDK handles:
 * - PbFrame protobuf encoding/decoding
 * - WebSocket connection lifecycle
 * - Heartbeat (ping/pong)
 * - Automatic reconnection with exponential backoff
 * - Event parsing into structured data
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { TokenManager } from '../../../services/notify-channels/token-manager'
import { proxyFetch } from '../../../services/proxy-fetch'
import type { EventSourceAdapter, AutomationEventInput } from '../event-types'
import type { ImChannelAdapter } from '../../../../shared/types/im-channel'
import type { FeishuBotConfig } from '../../../../shared/types/notification-channels'
import { sendMessage } from '../../../services/agent'
import { getConversation, createTaskConversation } from '../../../services/conversation.service'
import { onAgentEvent, type AgentEvent } from '../../../services/agent/events'
import { getWorkspaceTaskConversationId } from '../../../../shared/workspace-task-conversation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

// ---------------------------------------------------------------------------
// Token Manager (per appId)
// ---------------------------------------------------------------------------

const tokenManagers = new Map<string, TokenManager>()

function getTokenManager(config: FeishuBotConfig): TokenManager {
  const key = config.appId
  let manager = tokenManagers.get(key)
  if (!manager) {
    manager = new TokenManager('FeishuBot', async () => {
      const url = `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`
      const res = await proxyFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: config.appId,
          app_secret: config.appSecret,
        }),
      })
      const data = await res.json() as {
        code: number
        msg: string
        tenant_access_token: string
        expire: number
      }
      if (data.code !== 0) {
        throw new Error(`FeishuBot get token failed: ${data.code} ${data.msg}`)
      }
      return { token: data.tenant_access_token, expiresIn: data.expire }
    })
    tokenManagers.set(key, manager)
  }
  return manager
}

/** Clear cached token managers. */
export function clearFeishuBotTokenCache(): void {
  tokenManagers.clear()
}

// ---------------------------------------------------------------------------
// Source Implementation
// ---------------------------------------------------------------------------

export type FeishuBotConfigResolver = () => FeishuBotConfig | null

export class FeishuBotSource implements EventSourceAdapter, ImChannelAdapter {
  readonly id = 'feishu-bot'
  readonly type = 'feishu-bot' as const
  readonly channel = 'feishu-bot'

  private emitFn: ((event: AutomationEventInput) => void) | null = null
  private configResolver: FeishuBotConfigResolver
  private wsClient: Lark.WSClient | null = null
  private active = false

  constructor(configResolver: FeishuBotConfigResolver) {
    this.configResolver = configResolver
  }

  // ── EventSourceAdapter Interface ────────────────────────────────────────

  start(emit: (event: AutomationEventInput) => void): void {
    this.emitFn = emit
    this.active = true

    const config = this.configResolver()
    if (!config || !config.enabled || !config.appId || !config.appSecret) {
      console.log('[FeishuBotSource] Not configured or disabled — skipping start')
      return
    }

    this.createClient(config)

    console.log('[FeishuBotSource] Started')
  }

  stop(): void {
    this.active = false
    this.emitFn = null

    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch { /* ignore */ }
      this.wsClient = null
    }

    console.log('[FeishuBotSource] Stopped')
  }

  // ── Public API for Reply ────────────────────────────────────────────────

  /**
   * Send a reply to a specific Feishu chat via HTTP API.
   */
  replyToChat(chatId: string, text: string): boolean {
    this.sendMessage(chatId, text).catch((err) => {
      console.error(`[FeishuBotSource] Reply failed for chat ${chatId}:`, err)
    })
    return true
  }

  /**
   * Check if the WSClient is currently connected.
   */
  isConnected(): boolean {
    return this.wsClient?.getConnectionStatus().state === 'connected'
  }

  // ── ImChannelAdapter: Proactive Push ────────────────────────────────────

  /**
   * Push a message proactively to a Feishu chat via HTTP API.
   */
  pushToChat(chatId: string, text: string, _chatType: 'direct' | 'group'): boolean {
    this.sendMessage(chatId, text).catch((err) => {
      console.error(`[FeishuBotSource] Push failed for chat ${chatId}:`, err)
    })
    return true
  }

  // ── Reconnect (called when config changes in settings) ──────────────────

  /**
   * Reconnect with potentially updated config.
   * Called when feishuBot config changes in settings.
   */
  reconnectWithConfig(): void {
    if (!this.active) return

    // Close existing client
    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch { /* ignore */ }
      this.wsClient = null
    }

    const config = this.configResolver()
    if (!config || !config.enabled || !config.appId || !config.appSecret) {
      console.log('[FeishuBotSource] Config disabled or incomplete — disconnecting')
      return
    }

    this.createClient(config)
  }

  // ── Client Creation ─────────────────────────────────────────────────────

  private createClient(config: FeishuBotConfig): void {
    console.log('[FeishuBotSource] Creating WSClient...')

    try {
      this.wsClient = new Lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        autoReconnect: true,
        onReady: () => {
          console.log('[FeishuBotSource] WebSocket connected and ready')
        },
        onError: (err: Error) => {
          console.error('[FeishuBotSource] WSClient error:', err.message)
        },
        onReconnecting: () => {
          console.log('[FeishuBotSource] Reconnecting...')
        },
        onReconnected: () => {
          console.log('[FeishuBotSource] Reconnected')
        },
      })

      // Register event handlers and start
      const eventDispatcher = new Lark.EventDispatcher({})
        .register({
          'im.message.receive_v1': (data: any) => {
            this.handleInboundMessage(data)
          },
        })

      this.wsClient.start({ eventDispatcher }).catch((err: Error) => {
        console.error('[FeishuBotSource] Failed to start WSClient:', err.message)
      })
    } catch (err) {
      console.error('[FeishuBotSource] Failed to create WSClient:', err)
    }
  }

  // ── Message Handling ────────────────────────────────────────────────────

  private handleInboundMessage(data: any): void {
    if (!this.active) return

    const message = data.message as Record<string, unknown> | undefined
    const sender = data.sender as Record<string, unknown> | undefined
    if (!message || !sender) return

    // Extract sender info
    const senderId = (sender.sender_id as Record<string, unknown> | undefined)?.open_id as string | undefined
    const senderName = sender.sender_id
      ? ((sender.sender_id as Record<string, unknown>).union_id as string) ?? senderId
      : senderId

    // Extract message info — Feishu API uses message_type, not msg_type
    const chatId = message.chat_id as string | undefined
    const chatType = message.chat_type as string | undefined // 'p2p' or 'group'
    const msgType = (message.message_type ?? message.msg_type) as string | undefined
    const msgId = message.message_id as string | undefined
    const rawContent = message.content as string | undefined

    if (!chatId || !senderId) return

    // Extract text from content (Feishu text content is JSON string)
    let text = ''
    if (msgType === 'text' && rawContent) {
      if (typeof rawContent === 'string') {
        try {
          const parsed = JSON.parse(rawContent) as { text?: string }
          text = parsed.text ?? ''
        } catch {
          text = rawContent
        }
      } else {
        // SDK already parsed the JSON — access .text directly
        text = (rawContent as unknown as Record<string, unknown>)?.text as string ?? ''
      }
    } else if (msgType === 'image') {
      text = '(图片)'
    } else if (msgType === 'file') {
      text = '(文件)'
    } else if (rawContent) {
      text = `(${msgType ?? 'unknown'})`
    }

    if (!text.trim()) return

    console.log(
      `[FeishuBotSource] Message: chat=${chatId}, type=${chatType}, ` +
      `from=${senderId}, msgType=${msgType}, len=${text.length}`
    )

    // ── Route to configured conversation ──────────────────────────────

    const config = this.configResolver()
    if (!config?.routeTo) {
      console.warn(`[FeishuBotSource] No routeTo configured, dropping message from chat=${chatId}`)
      return
    }

    const { spaceId, type, conversationId, taskId, taskTitle } = config.routeTo

    // Determine target conversation ID
    let targetConversationId: string | undefined
    if (type === 'main-session') {
      targetConversationId = conversationId
    } else if (type === 'task' && taskId) {
      targetConversationId = getWorkspaceTaskConversationId(taskId)
    } else {
      console.warn(`[FeishuBotSource] Invalid routeTo config, dropping message`)
      return
    }

    if (!targetConversationId) {
      console.error(`[FeishuBotSource] No conversation ID available for routeTo type=${type}`)
      return
    }

    // Ensure task conversation exists
    let conv = getConversation(spaceId, targetConversationId)
    if (!conv && type === 'task' && taskId) {
      try {
        conv = createTaskConversation(spaceId, taskId, taskTitle)
        console.log(`[FeishuBotSource] Created task conversation for task=${taskId}`)
      } catch (err) {
        console.error(`[FeishuBotSource] Failed to create task conversation:`, err)
        return
      }
    } else if (!conv) {
      console.error(`[FeishuBotSource] Conversation not found: ${targetConversationId}`)
      return
    }

    // Acknowledge receipt with a thumbs-up reaction (fire-and-forget)
    if (msgId) {
      this.addReaction(msgId, 'Fire').catch(() => {})
    }

    console.log(`[FeishuBotSource] Routing to conversation=${targetConversationId}, text="${text.slice(0, 80)}"`)

    // Subscribe to agent:complete to capture the AI response and send it back to Feishu
    const sub = onAgentEvent((event: AgentEvent) => {
      if (
        event.channel === 'agent:complete' &&
        event.conversationId === targetConversationId &&
        event.spaceId === spaceId
      ) {
        try {
          const updatedConv = getConversation(spaceId, targetConversationId)
          if (updatedConv && updatedConv.messages.length > 0) {
            const lastMsg = updatedConv.messages[updatedConv.messages.length - 1]
            if (lastMsg.role === 'assistant' && lastMsg.content) {
              console.log(`[FeishuBotSource] Sending reply back to Feishu (${lastMsg.content.length} chars)`)
              // Use the public replyToChat method to send back
              this.replyToChat(chatId, lastMsg.content)
            }
          }
        } catch (err) {
          console.error(`[FeishuBotSource] Error capturing agent response:`, err)
        }
        // Cleanup subscription
        sub.dispose()
      }
    })

    // Send message to agent via the standard sendMessage path
    sendMessage({
      spaceId,
      conversationId: targetConversationId,
      message: text,
    }).catch((err) => {
      console.error(`[FeishuBotSource] sendMessage failed:`, err)
      sub.dispose()
    })
  }

  // ── Send Message (internal, via HTTP API) ──────────────────────────────

  /**
   * Send a text message to a specific Feishu chat via HTTP REST API.
   */
  private async sendMessage(chatId: string, text: string): Promise<boolean> {
    const config = this.configResolver()
    if (!config || !config.enabled) return false

    try {
      const manager = getTokenManager(config)
      const token = await manager.getToken()

      const url = `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`
      const res = await proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      })

      const data = await res.json() as {
        code: number
        msg: string
        data?: { message_id?: string }
      }

      // Handle token expiry
      if (data.code === 99991668 || data.code === 99991663) {
        console.log(`[FeishuBotSource] Token expired (code=${data.code}), retrying...`)
        manager.invalidate()
        const freshToken = await manager.getToken()

        const retryRes = await proxyFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
          }),
        })
        const retryData = await retryRes.json() as typeof data

        if (retryData.code !== 0) {
          console.error(`[FeishuBotSource] Send failed after retry: ${retryData.code} ${retryData.msg}`)
          return false
        }

        console.log(`[FeishuBotSource] Sent on retry, messageId=${retryData.data?.message_id}`)
        return true
      }

      if (data.code !== 0) {
        console.error(`[FeishuBotSource] Send failed: ${data.code} ${data.msg}`)
        return false
      }

      console.log(`[FeishuBotSource] Sent successfully, messageId=${data.data?.message_id}`)
      return true
    } catch (err) {
      console.error('[FeishuBotSource] Send error:', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  // ── Message Reaction ──────────────────────────────────────────────────

  /**
   * Add a reaction (emoji) to a Feishu message to acknowledge receipt.
   * Fire-and-forget — failures are logged but never thrown.
   */
  private async addReaction(messageId: string, emojiType: string): Promise<boolean> {
    const config = this.configResolver()
    if (!config || !config.enabled) return false

    try {
      const manager = getTokenManager(config)
      const token = await manager.getToken()

      const url = `${FEISHU_API_BASE}/im/v1/messages/${messageId}/reactions`
      const res = await proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          reaction_type: { emoji_type: emojiType },
        }),
      })

      const data = await res.json() as { code: number; msg: string }

      // Handle token expiry with retry
      if (data.code === 99991668 || data.code === 99991663) {
        console.log(`[FeishuBotSource] Reaction token expired (code=${data.code}), retrying...`)
        manager.invalidate()
        const freshToken = await manager.getToken()

        const retryRes = await proxyFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            reaction_type: { emoji_type: emojiType },
          }),
        })
        const retryData = await retryRes.json() as typeof data

        if (retryData.code !== 0) {
          console.warn(`[FeishuBotSource] Reaction failed after retry: ${retryData.code} ${retryData.msg}`)
          return false
        }

        console.log(`[FeishuBotSource] Reaction added on retry: ${emojiType} on ${messageId}`)
        return true
      }

      if (data.code !== 0) {
        // 1000001 = reaction already exists (e.g. duplicate), not an error
        if (data.code !== 1000001) {
          console.warn(`[FeishuBotSource] Reaction failed: ${data.code} ${data.msg}`)
        }
        return false
      }

      console.log(`[FeishuBotSource] Reaction added: ${emojiType} on ${messageId}`)
      return true
    } catch (err) {
      console.warn('[FeishuBotSource] Reaction error:', err instanceof Error ? err.message : String(err))
      return false
    }
  }
}
