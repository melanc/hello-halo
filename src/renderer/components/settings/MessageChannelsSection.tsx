/**
 * Message Channels Section Component (消息渠道)
 *
 * Unified settings section that merges:
 * - Notification Channels (one-way push: email, wecom app, dingtalk, feishu, webhook)
 * - WeCom Intelligent Bot (bidirectional WebSocket)
 *
 * Each channel is an expandable card showing:
 * - Channel name, description, direction badge (one-way / bidirectional)
 * - Status indicator (configured/connected/unconfigured)
 * - Credential fields when expanded
 *
 * IM Sessions are NOT shown here — they live in the digital human config.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Mail, MessageSquare, Bell, Webhook, Loader2,
  CheckCircle, XCircle, ChevronDown, RefreshCw, Bot,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import { useAppsStore } from '../../stores/apps.store'
import type { HaloConfig } from '../../types'
import { NOTIFICATION_CHANNEL_META } from '../../../shared/types/notification-channels'
import type {
  NotificationChannelType,
  NotificationChannelsConfig,
} from '../../../shared/types/notification-channels'

// ============================================
// Types
// ============================================

interface MessageChannelsSectionProps {
  config: HaloConfig | null
  setConfig: (config: HaloConfig) => void
}

interface TestResult {
  success: boolean
  error?: string
}

/** Field descriptor for data-driven form rendering */
interface FieldDef {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'toggle' | 'select'
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  nested?: string
}

/** Unified channel descriptor */
interface ChannelDef {
  /** Unique channel key */
  id: string
  /** Channel type for notification channels, or 'wecom-bot' for the bot */
  notifyType?: NotificationChannelType
  icon: typeof Mail
  labelKey: string
  descriptionKey: string
  /** 'one-way' = push only, 'bidirectional' = send + receive */
  direction: 'one-way' | 'bidirectional'
  fields: FieldDef[]
  defaults: Record<string, unknown>
}

// ============================================
// Channel Definitions
// ============================================

function buildChannelDefs(): ChannelDef[] {
  return [
    // ── Bidirectional channels ──
    {
      id: 'wecom-bot',
      icon: MessageSquare,
      labelKey: 'WeCom Intelligent Bot',
      descriptionKey: 'Bidirectional messaging via WeCom AI Bot WebSocket',
      direction: 'bidirectional',
      fields: [
        { key: 'botId', label: 'Bot ID', type: 'text', placeholder: 'aib-xxx', required: true },
        { key: 'secret', label: 'Secret', type: 'password', required: true },
        { key: 'wsUrl', label: 'WebSocket URL', type: 'text', placeholder: 'wss://openws.work.weixin.qq.com' },
      ],
      defaults: { enabled: false, botId: '', secret: '', wsUrl: '' },
    },
    // ── One-way notification channels ──
    {
      id: 'email',
      notifyType: 'email',
      icon: Mail,
      labelKey: NOTIFICATION_CHANNEL_META.email.labelKey,
      descriptionKey: NOTIFICATION_CHANNEL_META.email.descriptionKey,
      direction: 'one-way',
      fields: [
        { key: 'smtp.host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com', required: true, nested: 'smtp.host' },
        { key: 'smtp.port', label: 'SMTP Port', type: 'number', placeholder: '465', required: true, nested: 'smtp.port' },
        { key: 'smtp.secure', label: 'Use SSL/TLS', type: 'toggle', nested: 'smtp.secure' },
        { key: 'smtp.user', label: 'Username', type: 'text', placeholder: 'user@example.com', required: true, nested: 'smtp.user' },
        { key: 'smtp.password', label: 'Password', type: 'password', placeholder: 'App password', required: true, nested: 'smtp.password' },
        { key: 'defaultTo', label: 'Default Recipient', type: 'text', placeholder: 'recipient@example.com', required: true },
      ],
      defaults: { enabled: false, smtp: { host: '', port: 465, secure: true, user: '', password: '' }, defaultTo: '' },
    },
    {
      id: 'wecom',
      notifyType: 'wecom',
      icon: MessageSquare,
      labelKey: NOTIFICATION_CHANNEL_META.wecom.labelKey,
      descriptionKey: NOTIFICATION_CHANNEL_META.wecom.descriptionKey,
      direction: 'one-way',
      fields: [
        { key: 'corpId', label: 'Corp ID', type: 'text', placeholder: 'ww...', required: true },
        { key: 'agentId', label: 'Agent ID', type: 'number', placeholder: '1000002', required: true },
        { key: 'secret', label: 'Secret', type: 'password', required: true },
        { key: 'defaultToUser', label: 'Default User ID', type: 'text', placeholder: 'userid (optional)' },
        { key: 'defaultToParty', label: 'Default Party ID', type: 'text', placeholder: 'party id (optional)' },
      ],
      defaults: { enabled: false, corpId: '', agentId: 0, secret: '', defaultToUser: '', defaultToParty: '' },
    },
    {
      id: 'dingtalk',
      notifyType: 'dingtalk',
      icon: Bell,
      labelKey: NOTIFICATION_CHANNEL_META.dingtalk.labelKey,
      descriptionKey: NOTIFICATION_CHANNEL_META.dingtalk.descriptionKey,
      direction: 'one-way',
      fields: [
        { key: 'appKey', label: 'App Key', type: 'text', required: true },
        { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
        { key: 'agentId', label: 'Agent ID', type: 'number', placeholder: '0', required: true },
        { key: 'robotCode', label: 'Robot Code', type: 'text', placeholder: 'Robot code (optional)' },
        { key: 'defaultChatId', label: 'Default Chat ID', type: 'text', placeholder: 'Chat ID (optional)' },
      ],
      defaults: { enabled: false, appKey: '', appSecret: '', agentId: 0, robotCode: '', defaultChatId: '' },
    },
    {
      id: 'feishu',
      notifyType: 'feishu',
      icon: MessageSquare,
      labelKey: NOTIFICATION_CHANNEL_META.feishu.labelKey,
      descriptionKey: NOTIFICATION_CHANNEL_META.feishu.descriptionKey,
      direction: 'one-way',
      fields: [
        { key: 'appId', label: 'App ID', type: 'text', required: true },
        { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
        { key: 'defaultChatId', label: 'Default Chat ID', type: 'text', placeholder: 'Chat ID (optional)' },
        { key: 'defaultUserId', label: 'Default User ID', type: 'text', placeholder: 'User open_id (optional)' },
      ],
      defaults: { enabled: false, appId: '', appSecret: '', defaultChatId: '', defaultUserId: '' },
    },
    {
      id: 'webhook',
      notifyType: 'webhook',
      icon: Webhook,
      labelKey: NOTIFICATION_CHANNEL_META.webhook.labelKey,
      descriptionKey: NOTIFICATION_CHANNEL_META.webhook.descriptionKey,
      direction: 'one-way',
      fields: [
        { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/webhook', required: true },
        {
          key: 'method', label: 'Method', type: 'select',
          options: [{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }],
        },
        { key: 'headers', label: 'Headers (JSON)', type: 'text', placeholder: '{"Authorization": "Bearer ..."}' },
        { key: 'secret', label: 'HMAC Secret', type: 'password', placeholder: 'Signing secret (optional)' },
      ],
      defaults: { enabled: false, url: '', method: 'POST', headers: undefined, secret: '' },
    },
  ]
}

const CHANNEL_DEFS = buildChannelDefs()

// ============================================
// Helpers
// ============================================

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.')
  if (parts.length === 1) {
    return { ...obj, [parts[0]]: value }
  }
  const [head, ...rest] = parts
  const child = (obj[head] != null && typeof obj[head] === 'object') ? obj[head] as Record<string, unknown> : {}
  return { ...obj, [head]: setNestedValue(child, rest.join('.'), value) }
}

// ============================================
// Channel Field Renderer
// ============================================

interface ChannelFieldProps {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
}

function ChannelField({ field, value, onChange }: ChannelFieldProps) {
  const { t } = useTranslation()

  if (field.type === 'toggle') {
    const checked = Boolean(value)
    return (
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{t(field.label)}</label>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
            <div
              className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                checked ? 'translate-x-5' : 'translate-x-0.5'
              } mt-0.5`}
            />
          </div>
        </label>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t(field.label)}</label>
        <select
          value={(value as string) || field.options?.[0]?.value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'

  let displayValue: string
  if (field.key === 'headers' && typeof value === 'object' && value !== null) {
    displayValue = JSON.stringify(value)
  } else {
    displayValue = value != null ? String(value) : ''
  }

  const handleChange = (raw: string) => {
    if (field.type === 'number') {
      onChange(raw === '' ? 0 : Number(raw))
    } else if (field.key === 'headers') {
      onChange(raw === '' ? undefined : raw)
    } else {
      onChange(raw)
    }
  }

  const handleBlur = () => {
    if (field.key === 'headers' && typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)
        onChange(parsed)
      } catch {
        // Keep as raw string
      }
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">
        {t(field.label)}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={inputType}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={field.placeholder ? t(field.placeholder) : undefined}
        className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  )
}

// ============================================
// Channel Card
// ============================================

interface ChannelCardProps {
  def: ChannelDef
  channelConfig: Record<string, unknown>
  isExpanded: boolean
  onToggleExpand: () => void
  onSave: (def: ChannelDef, config: Record<string, unknown>) => Promise<void>
  onTest?: (channelType: string) => void
  isTesting?: boolean
  testResult?: TestResult
  /** WeCom Bot specific: connection status */
  botStatus?: { connected: boolean }
  onReconnect?: () => void
  /** Custom content rendered after fields (e.g. default digital human selector) */
  children?: React.ReactNode
}

function ChannelCard({
  def,
  channelConfig,
  isExpanded,
  onToggleExpand,
  onSave,
  onTest,
  isTesting,
  testResult,
  botStatus,
  onReconnect,
  children,
}: ChannelCardProps) {
  const { t } = useTranslation()
  const Icon = def.icon
  const isEnabled = Boolean(channelConfig?.enabled)

  // Local draft state for debounced saves
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentConfig = draft ?? channelConfig

  const scheduleSave = useCallback((updated: Record<string, unknown>) => {
    setDraft(updated)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      onSave(def, updated)
      setDraft(null)
      saveTimerRef.current = null
    }, 500)
  }, [def, onSave])

  const handleToggleEnabled = async () => {
    const updated = { ...currentConfig, enabled: !isEnabled }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setDraft(null)
    await onSave(def, updated)
  }

  const handleFieldChange = (fieldKey: string, value: unknown, nested?: string) => {
    const path = nested || fieldKey
    const updated = setNestedValue({ ...currentConfig }, path, value)
    scheduleSave(updated)
  }

  const getFieldValue = (field: FieldDef): unknown => {
    const path = field.nested || field.key
    return getNestedValue(currentConfig || {}, path)
  }

  // Status display
  const statusLabel = def.id === 'wecom-bot'
    ? (isEnabled && botStatus?.connected ? t('Connected') : isEnabled ? t('Disconnected') : t('Not configured'))
    : (isEnabled ? t('Configured') : t('Not configured'))

  const statusColor = def.id === 'wecom-bot'
    ? (isEnabled && botStatus?.connected ? 'bg-green-500' : isEnabled ? 'bg-amber-500' : 'bg-muted-foreground/30')
    : (isEnabled ? 'bg-green-500' : 'bg-muted-foreground/30')

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Card Header */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{t(def.labelKey)}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                def.direction === 'bidirectional'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {def.direction === 'bidirectional' ? t('Bidirectional') : t('One-way')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{t(def.descriptionKey)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:inline">{statusLabel}</span>
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Card Body */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border space-y-4 animate-in slide-in-from-top-1 duration-150">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('Enabled')}</p>
              <p className="text-xs text-muted-foreground">{t('Enable this channel')}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={handleToggleEnabled}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                    isEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  } mt-0.5`}
                />
              </div>
            </label>
          </div>

          {/* Channel fields */}
          <div className="space-y-3">
            {def.fields.map((field) => (
              <ChannelField
                key={field.key}
                field={field}
                value={getFieldValue(field)}
                onChange={(value) => handleFieldChange(field.key, value, field.nested)}
              />
            ))}
          </div>

          {/* Custom content (e.g. default digital human selector) */}
          {children}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            {/* Test button (notification channels only) */}
            {onTest && def.notifyType && (
              <button
                type="button"
                onClick={() => onTest(def.notifyType!)}
                disabled={isTesting || !isEnabled}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                {isTesting ? t('Testing...') : t('Test')}
              </button>
            )}

            {/* Reconnect button (WeCom Bot only) */}
            {def.id === 'wecom-bot' && isEnabled && onReconnect && (
              <button
                type="button"
                onClick={onReconnect}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('Reconnect')}
              </button>
            )}

            {/* Test result */}
            {testResult && (
              <div className={`flex items-center gap-1.5 text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                {testResult.success ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <span>
                  {testResult.success
                    ? t('Test passed')
                    : testResult.error || t('Test failed')}
                </span>
              </div>
            )}

            {/* WeCom Bot connection status detail */}
            {def.id === 'wecom-bot' && isEnabled && botStatus && (
              <div className={`flex items-center gap-1.5 text-sm ${botStatus.connected ? 'text-green-500' : 'text-amber-500'}`}>
                <div className={`w-2 h-2 rounded-full ${botStatus.connected ? 'bg-green-500' : 'bg-amber-500'}`} />
                <span>{botStatus.connected ? t('Connected') : t('Disconnected')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export function MessageChannelsSection({ config, setConfig }: MessageChannelsSectionProps) {
  const { t } = useTranslation()

  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set())
  const [testingChannel, setTestingChannel] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [botStatus, setBotStatus] = useState<{ connected: boolean }>({ connected: false })

  // Load automation apps for the default digital human selector
  const { apps, loadApps } = useAppsStore()
  const automationApps = apps.filter(a => a.spec.type === 'automation')

  useEffect(() => {
    loadApps()
  }, [loadApps])

  // Poll WeCom Bot status
  useEffect(() => {
    let cancelled = false
    async function fetchBotStatus() {
      try {
        const res = await api.getWecomBotStatus() as { success: boolean; data?: { connected: boolean } }
        if (!cancelled && res.success && res.data) {
          setBotStatus({ connected: res.data.connected })
        }
      } catch {
        // Ignore
      }
    }
    fetchBotStatus()
    const interval = setInterval(fetchBotStatus, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const toggleExpanded = useCallback((channelId: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) {
        next.delete(channelId)
      } else {
        next.add(channelId)
      }
      return next
    })
  }, [])

  const handleSaveChannel = useCallback(async (def: ChannelDef, channelConfig: Record<string, unknown>) => {
    if (!config) return

    if (def.id === 'wecom-bot') {
      // Save WeCom Bot config
      const updatedConfig = {
        ...config,
        wecomBot: channelConfig,
      } as HaloConfig
      try {
        await api.setConfig({ wecomBot: updatedConfig.wecomBot })
        setConfig(updatedConfig)
      } catch (error) {
        console.error('[MessageChannelsSection] Failed to save WeCom Bot config:', error)
      }
    } else if (def.notifyType) {
      // Save notification channel config
      const updatedConfig = {
        ...config,
        notificationChannels: {
          ...config.notificationChannels,
          [def.notifyType]: channelConfig,
        },
      } as HaloConfig
      try {
        await api.setConfig({ notificationChannels: updatedConfig.notificationChannels })
        setConfig(updatedConfig)
        api.clearNotificationChannelCache().catch(() => {})
      } catch (error) {
        console.error('[MessageChannelsSection] Failed to save channel config:', error)
      }
    }
  }, [config, setConfig])

  const handleTestChannel = useCallback(async (channelType: string) => {
    setTestingChannel(channelType)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[channelType]
      return next
    })
    try {
      const result = await api.testNotificationChannel(channelType) as { data: TestResult }
      setTestResults((prev) => ({ ...prev, [channelType]: result.data }))
    } catch {
      setTestResults((prev) => ({ ...prev, [channelType]: { success: false, error: t('Test failed') } }))
    } finally {
      setTestingChannel(null)
    }
  }, [t])

  const handleReconnect = useCallback(async () => {
    try {
      await api.reconnectWecomBot()
    } catch {
      // Ignore
    }
  }, [])

  const handleDefaultAppChange = useCallback(async (appId: string) => {
    if (!config) return
    const imChannels = { ...config.imChannels, defaultAppId: appId || undefined }
    try {
      await api.setConfig({ imChannels })
      setConfig({ ...config, imChannels } as HaloConfig)
    } catch (error) {
      console.error('[MessageChannelsSection] Failed to save default app:', error)
    }
  }, [config, setConfig])

  const getChannelConfig = (def: ChannelDef): Record<string, unknown> => {
    if (def.id === 'wecom-bot') {
      const bot = config?.wecomBot as Record<string, unknown> | undefined
      return bot ?? {}
    }
    if (def.notifyType) {
      const channels = config?.notificationChannels as NotificationChannelsConfig | undefined
      if (!channels) return {}
      const raw = channels[def.notifyType]
      return raw ? (raw as unknown as Record<string, unknown>) : {}
    }
    return {}
  }

  return (
    <section id="message-channels" className="bg-card rounded-xl border border-border p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-medium">{t('Message Channels')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Configure channels for sending and receiving messages with digital humans')}
        </p>
      </div>

      <div className="space-y-3">
        {CHANNEL_DEFS.map((def) => (
          <ChannelCard
            key={def.id}
            def={def}
            channelConfig={getChannelConfig(def)}
            isExpanded={expandedChannels.has(def.id)}
            onToggleExpand={() => toggleExpanded(def.id)}
            onSave={handleSaveChannel}
            onTest={def.notifyType ? handleTestChannel : undefined}
            isTesting={testingChannel === def.notifyType}
            testResult={def.notifyType ? testResults[def.notifyType] : undefined}
            botStatus={def.id === 'wecom-bot' ? botStatus : undefined}
            onReconnect={def.id === 'wecom-bot' ? handleReconnect : undefined}
          >
            {/* Default Digital Human selector — WeCom Bot only */}
            {def.id === 'wecom-bot' && (
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">
                  {t('Default Digital Human')}
                </label>
                <div className="relative">
                  <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <select
                    value={config?.imChannels?.defaultAppId || ''}
                    onChange={(e) => handleDefaultAppChange(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                  >
                    <option value="">{t('Not configured')}</option>
                    {automationApps.map(app => (
                      <option key={app.id} value={app.id}>
                        {app.spec.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('Inbound messages will be routed to this digital human for conversation')}
                </p>
              </div>
            )}
          </ChannelCard>
        ))}
      </div>
    </section>
  )
}
