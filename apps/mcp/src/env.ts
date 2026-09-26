export type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Environment values. The server is Bun-only (bun:sqlite); there is no
 * Worker deployment.
 */
export type Env = {
  MCP_PUBLIC_URL: string
  PORT?: string
  LOORA_MCP_PORT?: string
  REDIS_URL?: string
}

export function envValue(
  env: Env | NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = (env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
