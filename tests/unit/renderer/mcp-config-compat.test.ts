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
})
