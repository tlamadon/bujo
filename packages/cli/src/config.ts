import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Connection settings, after merging the config file and the environment. */
export interface Config {
  /** Database URL: `http://host:5984/bujo` or `https://<domain>/couchdb/bujo` */
  url?: string
  /** CouchDB basic auth */
  user?: string
  password?: string
  /** Cloudflare Access service token */
  cfClientId?: string
  cfClientSecret?: string
  /** Written to `userId` on documents this CLI creates or changes */
  userId?: string
  /** IANA timezone used to decide what "today" is (default: system timezone) */
  timezone?: string
}

export type ConfigKey = keyof Config
export type ConfigSource = 'env' | 'file' | 'flag'

const ENV_VARS: Record<ConfigKey, string> = {
  url: 'BUJO_URL',
  user: 'BUJO_USER',
  password: 'BUJO_PASSWORD',
  cfClientId: 'BUJO_CF_CLIENT_ID',
  cfClientSecret: 'BUJO_CF_CLIENT_SECRET',
  userId: 'BUJO_USER_ID',
  timezone: 'BUJO_TZ',
}

const KEYS = Object.keys(ENV_VARS) as ConfigKey[]
export const SECRET_KEYS: ConfigKey[] = ['password', 'cfClientSecret']

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface LoadedConfig {
  config: Config
  /** Where the config file is (or would be) */
  path: string
  fileFound: boolean
  /** Where each set value came from */
  sources: Partial<Record<ConfigKey, ConfigSource>>
  /** True when the file holds secrets and other users can read it */
  fileIsExposed: boolean
}

export function configPath(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) return override
  if (env.BUJO_CONFIG) return env.BUJO_CONFIG
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(base, 'bujo', 'config.json')
}

export function envVarFor(key: ConfigKey): string {
  return ENV_VARS[key]
}

/**
 * Read `~/.config/bujo/config.json` (if present) and apply `BUJO_*`
 * environment variables on top. Credentials embedded in the URL
 * (`http://user:pass@host/db`) are moved to `user` / `password`.
 */
export function loadConfig(env: NodeJS.ProcessEnv, pathOverride?: string): LoadedConfig {
  const path = configPath(env, pathOverride)
  const config: Config = {}
  const sources: Partial<Record<ConfigKey, ConfigSource>> = {}
  let fileIsExposed = false

  const fileFound = existsSync(path)
  if (fileFound) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (err) {
      throw new ConfigError(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConfigError(`${path} must contain a JSON object`)
    }
    const file = parsed as Record<string, unknown>
    for (const key of KEYS) {
      const value = file[key]
      if (value === undefined || value === null || value === '') continue
      if (typeof value !== 'string') throw new ConfigError(`${path}: "${key}" must be a string`)
      config[key] = value
      sources[key] = 'file'
    }
    if (process.platform !== 'win32' && SECRET_KEYS.some((k) => sources[k] === 'file')) {
      fileIsExposed = (statSync(path).mode & 0o077) !== 0
    }
  } else if (pathOverride) {
    throw new ConfigError(`Config file not found: ${path}`)
  }

  for (const key of KEYS) {
    const value = env[ENV_VARS[key]]
    if (value) {
      config[key] = value
      sources[key] = 'env'
    }
  }

  if (config.url) {
    let url: URL
    try {
      url = new URL(config.url)
    } catch {
      throw new ConfigError(`Invalid database URL "${config.url}"`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ConfigError(`Database URL must start with http:// or https:// (got "${config.url}")`)
    }
    if (url.username || url.password) {
      if (!config.user) {
        config.user = decodeURIComponent(url.username)
        sources.user = sources.url
      }
      if (!config.password) {
        config.password = decodeURIComponent(url.password)
        sources.password = sources.url
      }
      url.username = ''
      url.password = ''
    }
    config.url = url.toString().replace(/\/+$/, '')
  }

  return { config, path, fileFound, sources, fileIsExposed }
}

export type AuthMode = 'cloudflare-access' | 'basic' | 'none'

/** Which credentials will be sent. Both kinds can be combined. */
export function authModes(config: Config): AuthMode[] {
  const modes: AuthMode[] = []
  if (config.cfClientId || config.cfClientSecret) modes.push('cloudflare-access')
  if (config.user || config.password) modes.push('basic')
  return modes.length > 0 ? modes : ['none']
}

/** HTTP headers carrying the configured credentials. */
export function authHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = {}
  if (config.cfClientId || config.cfClientSecret) {
    if (!config.cfClientId || !config.cfClientSecret) {
      throw new ConfigError('A Cloudflare Access service token needs both BUJO_CF_CLIENT_ID and BUJO_CF_CLIENT_SECRET')
    }
    headers['CF-Access-Client-Id'] = config.cfClientId
    headers['CF-Access-Client-Secret'] = config.cfClientSecret
  }
  if (config.user || config.password) {
    const pair = `${config.user ?? ''}:${config.password ?? ''}`
    headers['Authorization'] = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`
  }
  return headers
}
