export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type Config = {
  port: number
  publicUrl: string
  redisUrl: string | null
}

export type EnvValues = Record<string, string | undefined>

export function configFrom(get: (key: string) => string | undefined): Config {
  const port = parsePort(get('PORT') ?? get('SHEET_MCP_PORT') ?? '4100')
  const publicUrl = cleanUrl(
    'MCP_PUBLIC_URL',
    get('MCP_PUBLIC_URL') ?? `http://localhost:${port}`,
  )
  return {
    port,
    publicUrl,
    redisUrl: optional(get('REDIS_URL')),
  }
}

function parsePort(value: string) {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT must be a valid TCP port')
  }
  return port
}

function optional(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function cleanUrl(name: string, value: string) {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  return value.trim().replace(/\/+$/, '')
}
