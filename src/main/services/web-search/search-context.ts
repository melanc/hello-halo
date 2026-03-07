/**
 * Web Search MCP - Search Context
 *
 * Core execution logic for programmatic web search.
 * Uses Electron BrowserView to load search pages and extract results
 * via JavaScript execution - no AI interpretation needed.
 *
 * Performance characteristics:
 * - Cold start (first search): ~2-3s
 * - Subsequent searches: ~1-2s
 * - Zero AI token consumption
 */

import { browserViewManager } from '../browser-view.service'
import { resolveEngines, type SearchEngine, type EngineName } from './engines'
import type { SearchResult, SearchResponse, SearchOptions, RawExtractionResult } from './types'

// ============================================
// Constants
// ============================================

/** Default search timeout (ms) */
const DEFAULT_TIMEOUT = 15_000

/** Maximum time to wait for page load (ms) */
const PAGE_LOAD_TIMEOUT = 10_000

/** Polling interval for selector wait (ms) */
const POLL_INTERVAL = 100

/** View ID prefix for search views */
const VIEW_ID_PREFIX = 'web-search-'

// ============================================
// Utility Functions
// ============================================

/**
 * Create a promise that rejects after timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} (timeout: ${ms}ms)`))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate unique view ID
 */
function generateViewId(): string {
  return `${VIEW_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================
// Search Context Class
// ============================================

/**
 * WebSearchContext - Manages search execution
 *
 * Each search creates a temporary offscreen BrowserView,
 * executes the search, extracts results, and cleans up.
 */
export class WebSearchContext {
  private activeViews = new Set<string>()

  /**
   * Execute a web search
   *
   * @param query - Search query
   * @param options - Search options
   * @returns Search response with results
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now()
    const maxResults = Math.min(options.maxResults || 8, 20)
    const timeout = options.timeout || DEFAULT_TIMEOUT

    // Resolve which engines to try
    const engines = resolveEngines(options.engine as 'auto' | EngineName | undefined, query)

    console.log(`[WebSearch] Starting search: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`)
    console.log(`[WebSearch] Engines to try: ${engines.map(e => e.name).join(', ')}`)

    let lastError: Error | null = null

    // Try each engine in order
    for (const engine of engines) {
      try {
        console.log(`[WebSearch] Trying engine: ${engine.displayName}`)

        const results = await this.executeSearch(engine, query, maxResults, timeout)

        if (results.length > 0) {
          const searchTime = Date.now() - startTime
          console.log(`[WebSearch] Success: ${results.length} results from ${engine.displayName} in ${searchTime}ms`)

          return {
            query,
            engine: engine.name,
            results,
            searchTime,
          }
        }

        console.log(`[WebSearch] ${engine.displayName} returned no results, trying next engine`)
      } catch (error) {
        lastError = error as Error
        console.warn(`[WebSearch] ${engine.displayName} failed:`, (error as Error).message)
        // Continue to next engine
      }
    }

    // All engines failed
    const searchTime = Date.now() - startTime
    const errorMessage = lastError?.message || 'No results found'

    console.error(`[WebSearch] All engines failed after ${searchTime}ms: ${errorMessage}`)

    // Return empty results with warning instead of throwing
    // This provides a better UX - the AI can still respond
    return {
      query,
      engine: engines[0]?.name || 'unknown',
      results: [],
      searchTime,
      warning: `Search failed: ${errorMessage}`,
    }
  }

  /**
   * Execute search with a specific engine
   */
  private async executeSearch(
    engine: SearchEngine,
    query: string,
    maxResults: number,
    timeout: number
  ): Promise<SearchResult[]> {
    const viewId = generateViewId()
    this.activeViews.add(viewId)

    try {
      // Build search URL
      const searchUrl = engine.buildSearchUrl(query, { maxResults })
      console.log(`[WebSearch] URL: ${searchUrl.slice(0, 100)}${searchUrl.length > 100 ? '...' : ''}`)

      // Create offscreen BrowserView
      console.log(`[WebSearch] Creating offscreen view: ${viewId}`)
      await browserViewManager.create(viewId, undefined, { offscreen: true })

      // Get webContents for this view
      const webContents = browserViewManager.getWebContents(viewId)
      if (!webContents) {
        throw new Error('Failed to get webContents for search view')
      }

      // Navigate to search URL
      console.log(`[WebSearch] Navigating to search page...`)
      await this.navigateWithTimeout(webContents, searchUrl, PAGE_LOAD_TIMEOUT)

      // Wait for results to appear
      console.log(`[WebSearch] Waiting for results selector: ${engine.waitForSelector}`)
      await this.waitForSelector(webContents, engine.waitForSelector, timeout)

      // Extra wait for dynamic content
      if (engine.extraWaitMs > 0) {
        console.log(`[WebSearch] Extra wait: ${engine.extraWaitMs}ms`)
        await sleep(engine.extraWaitMs)
      }

      // Extract results using primary selectors
      console.log(`[WebSearch] Extracting results...`)
      let rawResults = await this.extractResults(webContents, engine.buildExtractionScript(maxResults))

      // If no results, try fallback selectors
      if (rawResults.length === 0) {
        const fallbackScript = engine.buildFallbackExtractionScript(maxResults)
        if (fallbackScript) {
          console.log(`[WebSearch] Primary selectors failed, trying fallback...`)
          rawResults = await this.extractResults(webContents, fallbackScript)
        }
      }

      // Post-process results
      const results = engine.postProcess(rawResults)
      console.log(`[WebSearch] Extracted ${rawResults.length} raw, ${results.length} after processing`)

      return results
    } finally {
      // Always clean up the view
      await this.cleanupView(viewId)
    }
  }

  /**
   * Navigate to URL with timeout
   */
  private async navigateWithTimeout(
    webContents: Electron.WebContents,
    url: string,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Navigation timeout: ${url}`))
      }, timeout)

      const cleanup = () => {
        clearTimeout(timer)
        webContents.removeListener('did-finish-load', onLoad)
        webContents.removeListener('did-fail-load', onFail)
      }

      const onLoad = () => {
        cleanup()
        resolve()
      }

      const onFail = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean
      ) => {
        if (!isMainFrame) return
        // Ignore aborted loads (code -3)
        if (errorCode === -3) {
          cleanup()
          resolve()
          return
        }
        cleanup()
        reject(new Error(`Navigation failed: ${errorDescription} (code: ${errorCode})`))
      }

      webContents.once('did-finish-load', onLoad)
      webContents.once('did-fail-load', onFail)

      webContents.loadURL(url).catch((error) => {
        cleanup()
        reject(error)
      })
    })
  }

  /**
   * Wait for a selector to appear on the page
   */
  private async waitForSelector(
    webContents: Electron.WebContents,
    selector: string,
    timeout: number
  ): Promise<void> {
    const startTime = Date.now()
    const escapedSelector = selector.replace(/'/g, "\\'")

    while (Date.now() - startTime < timeout) {
      try {
        const exists = await webContents.executeJavaScript(
          `!!document.querySelector('${escapedSelector}')`
        )
        if (exists) {
          return
        }
      } catch (error) {
        // Page might be navigating, ignore and retry
      }

      await sleep(POLL_INTERVAL)
    }

    // Timeout - but don't throw, try to extract anyway
    console.warn(`[WebSearch] Selector wait timeout: ${selector}`)
  }

  /**
   * Extract results by executing JavaScript in the page
   */
  private async extractResults(
    webContents: Electron.WebContents,
    script: string
  ): Promise<RawExtractionResult[]> {
    try {
      const results = await webContents.executeJavaScript(script)
      return Array.isArray(results) ? results : []
    } catch (error) {
      console.error('[WebSearch] Extraction failed:', (error as Error).message)
      return []
    }
  }

  /**
   * Clean up a BrowserView
   */
  private async cleanupView(viewId: string): Promise<void> {
    if (!this.activeViews.delete(viewId)) return // already disposed
    try {
      browserViewManager.destroy(viewId)
      console.log(`[WebSearch] View cleaned up: ${viewId}`)
    } catch (error) {
      console.warn(`[WebSearch] Failed to cleanup view ${viewId}:`, (error as Error).message)
    }
  }

  /**
   * Clean up all resources
   */
  async dispose(): Promise<void> {
    for (const viewId of this.activeViews) {
      try {
        browserViewManager.destroy(viewId)
        console.log(`[WebSearch] View cleaned up: ${viewId}`)
      } catch (error) {
        console.warn(`[WebSearch] Failed to cleanup view ${viewId}:`, (error as Error).message)
      }
    }
    this.activeViews.clear()
  }
}

// ============================================
// Singleton Instance
// ============================================

let searchContext: WebSearchContext | null = null

/**
 * Get the singleton search context
 */
export function getSearchContext(): WebSearchContext {
  if (!searchContext) {
    searchContext = new WebSearchContext()
  }
  return searchContext
}

/**
 * Dispose the singleton search context
 */
export async function disposeSearchContext(): Promise<void> {
  if (searchContext) {
    await searchContext.dispose()
    searchContext = null
  }
}
