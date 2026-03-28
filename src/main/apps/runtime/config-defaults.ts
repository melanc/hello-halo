import type { InputDef } from '../../../shared/apps/spec-types'

/**
 * Merge config_schema defaults into userConfig.
 *
 * When a user installs an app but never opens the config panel,
 * userConfig is empty ({}). This function fills in missing keys
 * with the default values declared in config_schema, ensuring
 * the AI always sees the intended configuration.
 *
 * Only keys present in config_schema are included in the result.
 * This ensures that deleted or renamed config fields do not leak
 * stale values into the prompt at runtime.
 *
 * User-provided values always take precedence over defaults.
 */
export function mergeConfigWithDefaults(
  userConfig: Record<string, unknown> | undefined,
  configSchema: InputDef[] | undefined
): Record<string, unknown> {
  if (!configSchema) return { ...(userConfig ?? {}) }

  const schemaKeys = new Set(configSchema.map(d => d.key))
  // Only keep userConfig entries whose key still exists in the schema.
  // This prevents deleted or renamed fields from leaking into the prompt.
  const merged: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(userConfig ?? {})) {
    if (schemaKeys.has(k)) merged[k] = v
  }

  // Fill in schema defaults for any key the user has not set.
  for (const def of configSchema) {
    if (merged[def.key] === undefined && def.default !== undefined) {
      merged[def.key] = def.default
    }
  }
  return merged
}
