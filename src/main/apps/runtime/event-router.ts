/**
 * apps/runtime -- Event Router
 *
 * The automation event routing hub. A private implementation detail of
 * the apps/runtime module, not a platform-level service.
 *
 * Manages:
 * - Source adapter lifecycle (start/stop)
 * - Event deduplication via in-memory TTL cache
 * - Subscription registry (filter + handler pairs)
 * - Sequential dispatch with error isolation
 *
 * The platform-level generic pub/sub is Emitter<T> in platform/event.
 * This module is the domain-specific event routing for automation Apps.
 */

import { randomUUID } from 'crypto'
import type {
  AutomationEvent,
  AutomationEventInput,
  EventFilter,
  AutomationEventHandler,
  EventSourceAdapter,
  EventSourceInfo,
  DedupConfig,
} from './event-types'
import { matchesFilter } from './event-filter'
import { createDedupCache, type DedupCache } from './event-dedup'

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface Subscription {
  id: string
  filter: EventFilter
  handler: AutomationEventHandler
}

/** Function to unsubscribe a previously registered handler. */
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------
// EventRouter Interface
// ---------------------------------------------------------------------------

/**
 * The internal event routing service for automation Apps.
 *
 * This is the contract that apps/runtime/service.ts depends on.
 * It is NOT exported outside of apps/runtime.
 */
export interface EventRouter {
  /**
   * Emit an event into the router.
   *
   * The router assigns `id` and `timestamp` automatically.
   * If `dedupKey` is set and a duplicate is detected within the TTL,
   * the event is silently dropped.
   *
   * Matching subscribers are invoked sequentially with error isolation.
   */
  emit(event: AutomationEventInput): void

  /**
   * Subscribe to events matching the given filter.
   *
   * @returns An unsubscribe function. Calling it removes this subscription.
   */
  on(filter: EventFilter, handler: AutomationEventHandler): Unsubscribe

  /**
   * Register an event source adapter.
   *
   * The source is started immediately if the router is already running,
   * otherwise it will be started when `start()` is called.
   */
  registerSource(source: EventSourceAdapter): void

  /**
   * Remove and stop a previously registered event source adapter.
   */
  removeSource(sourceId: string): void

  /**
   * List all registered event source adapters with basic info.
   */
  listSources(): EventSourceInfo[]

  /**
   * Start the event router and all registered source adapters.
   */
  start(): void

  /**
   * Stop the event router and all registered source adapters.
   * Clears all subscriptions and the dedup cache.
   */
  stop(): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEventRouter(dedupConfig?: Partial<DedupConfig>): EventRouter {
  const subscriptions = new Map<string, Subscription>()
  const sources = new Map<string, { adapter: EventSourceAdapter; running: boolean }>()
  const dedup: DedupCache = createDedupCache(dedupConfig)
  let running = false

  // The emit function passed to source adapters.
  const emitFn = (partial: AutomationEventInput): void => {
    router.emit(partial)
  }

  const router: EventRouter = {
    emit(partial) {
      if (!running) return

      // Assign id and timestamp
      const event: AutomationEvent = {
        id: randomUUID(),
        timestamp: Date.now(),
        ...partial
      }

      // Deduplication check
      if (event.dedupKey && dedup.isDuplicate(event.dedupKey)) {
        return
      }

      // Dispatch to matching subscribers (sequential, error-isolated)
      // We use void Promise to avoid unhandled rejections while keeping
      // the emit() signature synchronous (fire-and-forget for sources).
      void dispatchEvent(event)
    },

    on(filter, handler) {
      const subId = randomUUID()
      subscriptions.set(subId, { id: subId, filter, handler })

      // Return unsubscribe function
      const unsub: Unsubscribe = () => {
        subscriptions.delete(subId)
      }
      return unsub
    },

    registerSource(source) {
      if (sources.has(source.id)) {
        console.warn(`[EventRouter] Source already registered: ${source.id}. Replacing.`)
        // Stop the existing one first
        const existing = sources.get(source.id)
        if (existing?.running) {
          try { existing.adapter.stop() } catch { /* ignore */ }
        }
      }

      const entry = { adapter: source, running: false }
      sources.set(source.id, entry)

      // If router is already running, start the source immediately
      if (running) {
        try {
          source.start(emitFn)
          entry.running = true
          console.log(`[EventRouter] Source started: ${source.id} (${source.type})`)
        } catch (err) {
          console.error(`[EventRouter] Failed to start source ${source.id}:`, err)
        }
      }
    },

    removeSource(sourceId) {
      const entry = sources.get(sourceId)
      if (!entry) return

      if (entry.running) {
        try {
          entry.adapter.stop()
        } catch (err) {
          console.error(`[EventRouter] Error stopping source ${sourceId}:`, err)
        }
      }

      sources.delete(sourceId)
      console.log(`[EventRouter] Source removed: ${sourceId}`)
    },

    listSources() {
      const result: EventSourceInfo[] = []
      for (const entry of Array.from(sources.values())) {
        result.push({
          id: entry.adapter.id,
          type: entry.adapter.type,
          running: entry.running
        })
      }
      return result
    },

    start() {
      if (running) return
      running = true
      console.log(`[EventRouter] Starting with ${sources.size} source(s)...`)

      for (const entry of Array.from(sources.values())) {
        if (entry.running) continue
        try {
          entry.adapter.start(emitFn)
          entry.running = true
          console.log(`[EventRouter] Source started: ${entry.adapter.id} (${entry.adapter.type})`)
        } catch (err) {
          console.error(`[EventRouter] Failed to start source ${entry.adapter.id}:`, err)
        }
      }

      console.log(`[EventRouter] Started. ${subscriptions.size} subscription(s) active.`)
    },

    stop() {
      if (!running) return
      running = false
      console.log('[EventRouter] Stopping...')

      // Stop all sources
      for (const entry of Array.from(sources.values())) {
        if (!entry.running) continue
        try {
          entry.adapter.stop()
          entry.running = false
        } catch (err) {
          console.error(`[EventRouter] Error stopping source ${entry.adapter.id}:`, err)
        }
      }

      // Clear subscriptions and dedup cache
      subscriptions.clear()
      dedup.clear()

      console.log('[EventRouter] Stopped.')
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatch an event to all matching subscribers.
   *
   * Handlers are invoked sequentially. If a handler throws or rejects,
   * the error is logged and the next handler is still called (error isolation).
   */
  async function dispatchEvent(event: AutomationEvent): Promise<void> {
    for (const sub of Array.from(subscriptions.values())) {
      if (!matchesFilter(event, sub.filter)) continue

      try {
        const result = sub.handler(event)
        // Await if the handler is async
        if (result && typeof (result as Promise<void>).then === 'function') {
          await result
        }
      } catch (err) {
        console.error(
          `[EventRouter] Handler error (sub=${sub.id}, event=${event.type}):`,
          err
        )
      }
    }
  }

  return router
}
