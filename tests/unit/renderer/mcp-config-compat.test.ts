import { describe, expect, it } from 'vitest'

import {
  internalMcpServerToJsonConfig,
  keyValueLinesToRecord,
  mcpJsonConfigToInternal,
  recordToKeyValueLines,
  validateMcpJsonConfig,
} from '../../../src/renderer/utils/mcpConfigCompat'

describe('mcpConfigCompat', () => {
  it('accepts Claude/Cursor stdio JSON config', () => {
    const result = mcpJsonConfigToInternal({
      command: 'npx',
      args: ['-y', '@example/mcp'],
      env: { API_KEY: 'token' },
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/mcp'],
      env: { API_KEY: 'token' },
    })
  })

  it('converts Claude/Cursor HTTP JSON config into internal app-spec format', () => {
    const result = mcpJsonConfigToInternal({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      transport: 'streamable-http',
      command: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })
  })

  it('accepts legacy internal MCP app-spec format during JSON editing', () => {
    const result = mcpJsonConfigToInternal({
      transport: 'sse',
      command: 'https://example.com/sse',
      headers: {
        Authorization: 'Bearer token',
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      transport: 'sse',
      command: 'https://example.com/sse',
      headers: {
        Authorization: 'Bearer token',
      },
    })
  })

  it('serializes internal HTTP config back to Claude/Cursor JSON format', () => {
    const jsonConfig = internalMcpServerToJsonConfig({
      transport: 'streamable-http',
      command: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })

    expect(jsonConfig).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })
  })

  it('rejects nested wrapped config objects', () => {
    expect(validateMcpJsonConfig({
      server: {
        command: 'npx',
      },
    })).toBe('Invalid format: detected nested "server". Configure the MCP server object directly without extra nesting.')
  })

  it('round-trips key-value text helpers', () => {
    const record = keyValueLinesToRecord('API_KEY=token\nAuthorization=Bearer x')
    expect(record).toEqual({
      API_KEY: 'token',
      Authorization: 'Bearer x',
    })
    expect(recordToKeyValueLines(record)).toBe('API_KEY=token\nAuthorization=Bearer x')
  })

  // ── env value coercion ──

  it('accepts numeric and boolean env values and coerces to strings', () => {
    const result = mcpJsonConfigToInternal({
      command: 'npx',
      args: ['-y', '@example/mcp'],
      env: { API_KEY: 'token', PORT: 8080, DEBUG: true, VERBOSE: false },
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/mcp'],
      env: { API_KEY: 'token', PORT: '8080', DEBUG: 'true', VERBOSE: 'false' },
    })
  })

  it('accepts zero as a valid env value', () => {
    const result = mcpJsonConfigToInternal({
      command: 'npx',
      env: { COUNT: 0 },
    })
    expect(result.error).toBeUndefined()
    expect(result.data!.env).toEqual({ COUNT: '0' })
  })

  it('rejects object env values', () => {
    const error = validateMcpJsonConfig({
      command: 'npx',
      env: { COMPLEX: { nested: true } },
    })
    expect(error).toContain('env.COMPLEX')
  })

  it('rejects null env values', () => {
    const error = validateMcpJsonConfig({
      command: 'npx',
      env: { BAD: null },
    })
    expect(error).toContain('env.BAD')
  })

  it('rejects array env values', () => {
    const error = validateMcpJsonConfig({
      command: 'npx',
      env: { BAD: [1, 2] },
    })
    expect(error).toContain('env.BAD')
  })

  // ── streamable-http external type ──

  it('accepts streamable-http type in external config', () => {
    const result = mcpJsonConfigToInternal({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      transport: 'streamable-http',
      command: 'https://example.com/mcp',
    })
  })

  it('maps both http and streamable-http to internal streamable-http transport', () => {
    const httpResult = mcpJsonConfigToInternal({ type: 'http', url: 'https://example.com/mcp' })
    const shResult = mcpJsonConfigToInternal({ type: 'streamable-http', url: 'https://example.com/mcp' })

    expect(httpResult.data?.transport).toBe('streamable-http')
    expect(shResult.data?.transport).toBe('streamable-http')
  })

  it('rejects unknown type values', () => {
    const error = validateMcpJsonConfig({
      type: 'websocket',
      url: 'wss://example.com',
    })
    expect(error).toContain('type must be one of')
  })
})
