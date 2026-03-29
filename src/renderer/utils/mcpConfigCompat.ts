import type { McpServerConfig } from '../../shared/apps/spec-types'

export type McpJsonConfig =
  | {
    type?: 'stdio'
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
  }
  | {
    type: 'sse' | 'http' | 'streamable-http'
    url: string
    headers?: Record<string, string>
    env?: Record<string, string>
  }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateStringArray(value: unknown, fieldName: string): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) {
    return `${fieldName} must be an array`
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      return `${fieldName}[${i}] must be a string`
    }
  }
  return null
}

function validateStringRecord(value: unknown, fieldName: string): string | null {
  if (value === undefined) return null
  if (!isRecord(value)) {
    return `${fieldName} must be an object`
  }
  for (const [key, entry] of Object.entries(value)) {
    const t = typeof entry
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      return `${fieldName}.${key} must be a string, number, or boolean`
    }
  }
  return null
}

function detectNestedConfigError(config: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(config)) {
    if (!isRecord(value)) continue
    if ('command' in value || 'type' in value || 'transport' in value || 'url' in value) {
      return `Invalid format: detected nested "${key}". Configure the MCP server object directly without extra nesting.`
    }
  }
  return null
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    const t = typeof entry
    if (t === 'string' || t === 'number' || t === 'boolean') {
      entries.push([key, String(entry)])
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeInternalConfig(config: Record<string, unknown>): McpServerConfig {
  const transport = (config.transport as McpServerConfig['transport'] | undefined) ?? 'stdio'
  return {
    transport,
    command: String(config.command).trim(),
    ...(Array.isArray(config.args) && config.args.length > 0 ? { args: config.args as string[] } : {}),
    ...(normalizeStringRecord(config.env) ? { env: normalizeStringRecord(config.env)! } : {}),
    ...(normalizeStringRecord(config.headers) ? { headers: normalizeStringRecord(config.headers)! } : {}),
    ...(typeof config.cwd === 'string' && config.cwd.trim() ? { cwd: config.cwd.trim() } : {}),
  }
}

function normalizeExternalConfig(config: Record<string, unknown>): McpServerConfig {
  const type = config.type as 'stdio' | 'sse' | 'http' | 'streamable-http' | undefined
  if (type === 'sse' || type === 'http' || type === 'streamable-http') {
    return {
      transport: type === 'sse' ? 'sse' : 'streamable-http',
      command: String(config.url).trim(),
      ...(normalizeStringRecord(config.headers) ? { headers: normalizeStringRecord(config.headers)! } : {}),
      ...(normalizeStringRecord(config.env) ? { env: normalizeStringRecord(config.env)! } : {}),
    }
  }

  return {
    transport: 'stdio',
    command: String(config.command).trim(),
    ...(Array.isArray(config.args) && config.args.length > 0 ? { args: config.args as string[] } : {}),
    ...(normalizeStringRecord(config.env) ? { env: normalizeStringRecord(config.env)! } : {}),
    ...(typeof config.cwd === 'string' && config.cwd.trim() ? { cwd: config.cwd.trim() } : {}),
  }
}

function validateInternalConfig(config: Record<string, unknown>): string | null {
  const transport = config.transport
  if (transport !== undefined && transport !== 'stdio' && transport !== 'sse' && transport !== 'streamable-http') {
    return 'transport must be one of: stdio, sse, streamable-http'
  }
  if (typeof config.command !== 'string' || !config.command.trim()) {
    return 'command must be a non-empty string'
  }
  const argsError = validateStringArray(config.args, 'args')
  if (argsError) return argsError
  const envError = validateStringRecord(config.env, 'env')
  if (envError) return envError
  const headersError = validateStringRecord(config.headers, 'headers')
  if (headersError) return headersError
  if (config.cwd !== undefined && typeof config.cwd !== 'string') {
    return 'cwd must be a string'
  }
  if ((transport === 'sse' || transport === 'streamable-http')) {
    try {
      new URL(String(config.command))
    } catch {
      return 'command must be a valid URL for sse/streamable-http transport'
    }
  }
  return null
}

function validateExternalConfig(config: Record<string, unknown>): string | null {
  const type = config.type
  if (type !== undefined && type !== 'stdio' && type !== 'sse' && type !== 'http' && type !== 'streamable-http') {
    return 'type must be one of: stdio, sse, http, streamable-http'
  }

  if (type === 'sse' || type === 'http' || type === 'streamable-http') {
    if (typeof config.url !== 'string' || !config.url.trim()) {
      return 'url must be a non-empty string'
    }
    try {
      new URL(config.url)
    } catch {
      return 'url must be a valid URL'
    }
    const headersError = validateStringRecord(config.headers, 'headers')
    if (headersError) return headersError
    const envError = validateStringRecord(config.env, 'env')
    if (envError) return envError
    return null
  }

  if (typeof config.command !== 'string' || !config.command.trim()) {
    return 'command must be a non-empty string'
  }
  const argsError = validateStringArray(config.args, 'args')
  if (argsError) return argsError
  const envError = validateStringRecord(config.env, 'env')
  if (envError) return envError
  if (config.cwd !== undefined && typeof config.cwd !== 'string') {
    return 'cwd must be a string'
  }
  return null
}

export function validateMcpJsonConfig(config: unknown): string | null {
  if (!isRecord(config)) {
    return 'Configuration must be an object'
  }

  const nestedError = detectNestedConfigError(config)
  if (nestedError) return nestedError

  if ('transport' in config) {
    return validateInternalConfig(config)
  }

  if ('type' in config) {
    return validateExternalConfig(config)
  }

  if ('command' in config) {
    return validateExternalConfig(config)
  }

  return 'Invalid format: requires command (stdio) or type + url (http/sse)'
}

export function mcpJsonConfigToInternal(config: unknown): { data?: McpServerConfig; error?: string } {
  const error = validateMcpJsonConfig(config)
  if (error) return { error }

  const record = config as Record<string, unknown>
  if ('transport' in record) {
    return { data: normalizeInternalConfig(record) }
  }
  return { data: normalizeExternalConfig(record) }
}

export function internalMcpServerToJsonConfig(config: McpServerConfig): McpJsonConfig {
  if (config.transport === 'sse' || config.transport === 'streamable-http') {
    return {
      type: config.transport === 'streamable-http' ? 'http' : 'sse',
      url: config.command,
      ...(config.headers && Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
      ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
    }
  }

  return {
    command: config.command,
    ...(config.args && config.args.length > 0 ? { args: config.args } : {}),
    ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
  }
}

export function recordToKeyValueLines(record?: Record<string, string>): string {
  if (!record || Object.keys(record).length === 0) return ''
  return Object.entries(record).map(([key, value]) => `${key}=${value}`).join('\n')
}

export function keyValueLinesToRecord(text: string): Record<string, string> | undefined {
  const record: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) {
      record[key] = value
    }
  }
  return Object.keys(record).length > 0 ? record : undefined
}
