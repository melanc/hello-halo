/**
 * Browser Homepage Utility
 *
 * Fetches the default browser homepage URL from the main process (respects
 * browser policy configuration). The result is cached after the first call.
 */

import { api } from '../api'

const FALLBACK = 'https://www.bing.com'

let cached: string | null = null

export async function getBrowserHomepage(): Promise<string> {
  if (cached !== null) return cached
  try {
    cached = await api.getBrowserHomepage()
  } catch {
    cached = FALLBACK
  }
  return cached
}
