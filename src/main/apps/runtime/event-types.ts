/**
 * apps/runtime -- Automation Event Types
 *
 * Types for events flowing through the automation event routing layer.
 * These are domain-specific to automation Apps: file changes, webhooks,
 * and scheduled triggers. They do NOT belong in platform/ because they
 * are consumed exclusively by the apps/runtime module.
 *
 * Design: The generic publish/subscribe primitive is Emitter<T> in
 * platform/event. These types define the domain-specific event payload
 * and filtering for the automation use case.
 */

// ---------------------------------------------------------------------------
// Core Event
// ---------------------------------------------------------------------------

/**
 * A normalized automation event produced by source adapters.
 *
 * All source adapters (file-watcher, webhook, schedule-bridge) produce
 * AutomationEvent instances. The runtime's event router dispatches
 * these to matching App subscriptions after filtering and dedup.
 */
export interface AutomationEvent {
  /** Unique event identifier (UUID v4, assigned by the router on emit). */
  id: string
  /**
   * Dotted event type string.
   *
   * Convention: `{source-category}.{verb}`
   * Examples: "file.changed", "file.created", "file.deleted",
   *           "webhook.received", "schedule.due"
   */
  type: string
  /** Identifier of the event source adapter that produced this event. */
  source: string
  /** Unix timestamp in milliseconds when the event was emitted. */
  timestamp: number
  /** Arbitrary payload data specific to the event type. */
  payload: Record<string, unknown>
  /**
   * Optional deduplication key.
   *
   * If set, events with the same dedupKey within the TTL window
   * are silently dropped. Useful for preventing duplicate webhook
   * deliveries, file-watcher burst events, etc.
   */
  dedupKey?: string
}

/**
 * Partial event as produced by source adapters.
 * The router assigns `id` and `timestamp` automatically.
 */
export type AutomationEventInput = Omit<AutomationEvent, 'id' | 'timestamp'>

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Subscription filter. All specified criteria must match (AND logic).
 * Omitted fields are treated as "match any".
 */
export interface EventFilter {
  /**
   * Event types to match. Supports simple glob:
   * - `"file.changed"` -- exact match
   * - `"file.*"` -- matches any type starting with `"file."`
   * - `"*"` -- matches everything
   */
  types?: string[]
  /** Source adapter IDs to match. Exact match only. */
  sources?: string[]
  /** Rule-based field matching (zero LLM cost pre-filtering). */
  rules?: FilterRule[]
}

/**
 * A single field-level filter rule.
 *
 * Rules are evaluated against the full AutomationEvent object, so `field`
 * can reference any property path: `"type"`, `"source"`,
 * `"payload.extension"`, `"payload.items[0].price"`, etc.
 */
export interface FilterRule {
  /**
   * Dot-separated field path into the AutomationEvent.
   * Supports array index notation: `"payload.items[0].name"`
   */
  field: string
  /** Comparison operator. */
  op: 'eq' | 'neq' | 'contains' | 'matches' | 'gt' | 'lt' | 'in' | 'nin'
  /** Value to compare against. Type depends on the operator. */
  value: unknown
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Event handler callback. May be sync or async. */
export type AutomationEventHandler = (event: AutomationEvent) => void | Promise<void>

// ---------------------------------------------------------------------------
// Source Adapters
// ---------------------------------------------------------------------------

/** Supported event source types. */
export type EventSourceType =
  | 'file-watcher'
  | 'webhook'
  | 'schedule-bridge'
  | 'webpage'    // V2 placeholder
  | 'rss'        // V2 placeholder
  | 'wecom-bot'
  | 'internal'

/**
 * Unified interface for all information source adapters.
 *
 * V1 implements three built-in adapters:
 * - FileWatcherSource: wraps the existing file-watcher worker
 * - WebhookSource: mounts POST /hooks/* on the existing Express server
 * - ScheduleBridgeSource: bridges scheduler jobDue events
 *
 * V2 will add WebPageSource (AI Browser snapshot + diff) and RSSSource.
 */
export interface EventSourceAdapter {
  /** Unique identifier for this source instance. */
  id: string
  /** Type discriminator. */
  type: EventSourceType
  /**
   * Start producing events.
   *
   * @param emit - Callback to push events into the router. The source calls
   *   this whenever it has a new event. The router handles id/timestamp
   *   assignment, dedup, filtering, and dispatch.
   */
  start(emit: (event: AutomationEventInput) => void): void
  /**
   * Stop producing events and clean up all listeners/routes.
   *
   * Must be safe to call multiple times. Must not throw.
   */
  stop(): void
}

/** Summary information about a registered source adapter. */
export interface EventSourceInfo {
  id: string
  type: EventSourceType
  running: boolean
}

// ---------------------------------------------------------------------------
// Dedup Configuration
// ---------------------------------------------------------------------------

/** Configuration for the in-memory dedup cache. */
export interface DedupConfig {
  /** Time-to-live in milliseconds for dedup entries. Default: 60_000 (60s). */
  ttlMs: number
  /** Maximum number of entries in the cache. Default: 10_000. */
  maxSize: number
}
