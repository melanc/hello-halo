/**
 * MCP Server Configuration Validation
 * Validates Claude/Cursor-compatible JSON config and legacy internal app-spec MCP config.
 */

import { validateMcpJsonConfig } from './mcpConfigCompat'

/**
 * Validate a single MCP server configuration
 * @param config - The configuration object to validate
 * @returns Error message string if invalid, null if valid
 */
export function validateMcpServerConfig(config: unknown): string | null {
  return validateMcpJsonConfig(config)
}

/**
 * Validate server name
 * @param name - The server name to validate
 * @param existingNames - List of existing server names (for duplicate check)
 * @param currentName - Current name if editing (to allow keeping same name)
 * @returns Error message string if invalid, null if valid
 */
export function validateMcpServerName(
  name: string,
  existingNames: string[],
  currentName?: string
): string | null {
  if (!name || !name.trim()) {
    return 'Server name is required'
  }

  // Check for invalid characters (allow alphanumeric, dash, underscore, dot, @, /)
  if (!/^[\w@][\w.@\/-]*$/.test(name)) {
    return 'Name can only include letters, numbers, and . @ / _ -'
  }

  // Check for duplicates (excluding current name if editing)
  if (name !== currentName && existingNames.includes(name)) {
    return 'Name already exists'
  }

  return null
}
