/**
 * Registry Adapter Interface
 *
 * Each adapter is responsible for fetching and normalising data from one
 * external registry protocol into the canonical RegistryIndex / AppSpec
 * shapes used by the rest of the store system.
 *
 * Adding a new source = adding one file that implements this interface.
 * No other core logic needs to change.
 *
 * Two data strategies:
 *   - mirror:  Small/static sources. Full index downloaded, stored in SQLite.
 *   - proxy:   Large API sources. Queries forwarded on demand, results cached.
 */

import type { RegistrySource, RegistryIndex, RegistryEntry, StoreQueryParams } from '../../../shared/store/store-types'
import type { AppSpec } from '../../apps/spec/schema'

/** Result of a proxy query to a remote API source */
export interface AdapterQueryResult {
  items: RegistryEntry[]
  total?: number
  hasMore: boolean
}

export interface RegistryAdapter {
  /** Data strategy: 'mirror' for full-index sources, 'proxy' for API sources */
  readonly strategy: 'mirror' | 'proxy'

  /**
   * Mirror mode: download the full index from the source.
   * Only required when strategy = 'mirror'.
   */
  fetchIndex?(source: RegistrySource): Promise<RegistryIndex>

  /**
   * Proxy mode: query the source API with pagination.
   * Only required when strategy = 'proxy'.
   */
  query?(source: RegistrySource, params: StoreQueryParams): Promise<AdapterQueryResult>

  /**
   * Fetch (or construct) the full AppSpec for a single registry entry.
   * All adapters must implement this.
   */
  fetchSpec(source: RegistrySource, entry: RegistryEntry): Promise<AppSpec>
}
