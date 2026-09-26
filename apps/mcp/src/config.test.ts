import { describe, expect, test } from 'vitest'
import { configFrom } from './config'

function from(values: Record<string, string>) {
  return configFrom((key) => values[key])
}

describe('MCP server config', () => {
  test('defaults the public url from the port', () => {
    const config = from({ SHEET_MCP_PORT: '4100' })
    expect(config.port).toBe(4100)
    expect(config.publicUrl).toBe('http://localhost:4100')
    expect(config.redisUrl).toBeNull()
  })

  test('rate limit uses the shared redis url', () => {
    const config = from({ REDIS_URL: ' redis://localhost:6379 ' })
    expect(config.redisUrl).toBe('redis://localhost:6379')
  })
})
