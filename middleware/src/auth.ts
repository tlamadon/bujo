// Who is making this request?
//
// Browsers reach the server through Cloudflare Access after an identity
// login; Cloudflare then adds `Cf-Access-Authenticated-User-Email`, which is
// the userId. That path is unchanged.
//
// A Cloudflare Access *service token* (used by the `bujo` CLI) has no email.
// The only thing identifying it at the origin is the signed JWT Cloudflare
// puts in `Cf-Access-Jwt-Assertion`, whose `common_name` claim is the
// token's Client ID. So for service tokens we verify that JWT (signature
// against the team's public keys, issuer, audience, expiry) and map the
// Client ID to a userId through an explicit allowlist. Nothing is accepted
// on the say-so of an unverified header.

export interface AccessConfig {
  /** `https://<team>.cloudflareaccess.com` — the expected JWT issuer */
  issuer: string
  /** The Access application's AUD tag */
  audience: string
  /** Service token Client ID (`….access`) → userId to write as */
  serviceTokens: Map<string, string>
}

export interface AuthOptions {
  fetch?: typeof fetch
  /** Clock in epoch milliseconds */
  now?: () => number
  log?: (message: string) => void
}

type Env = Record<string, string | undefined>

/**
 * Parse `BUJO_SERVICE_TOKENS`: comma-separated `clientId=userId` pairs, e.g.
 * `1a2b3c.access=me@example.com,4d5e6f.access=partner@example.com`.
 */
export function parseServiceTokens(value: string | undefined): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const pair of (value ?? '').split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    const clientId = eq < 0 ? '' : trimmed.slice(0, eq).trim()
    const userId = eq < 0 ? '' : trimmed.slice(eq + 1).trim()
    if (!clientId || !userId) {
      throw new Error(`BUJO_SERVICE_TOKENS: expected "clientId=userId", got "${trimmed}"`)
    }
    tokens.set(clientId, userId)
  }
  return tokens
}

/**
 * Read the service-token settings from the environment. Returns null — the
 * service-token path stays off — unless tokens are mapped *and* both values
 * needed to verify their JWTs are present.
 */
export function loadAccessConfig(env: Env, log: (message: string) => void = console.error): AccessConfig | null {
  let serviceTokens: Map<string, string>
  try {
    serviceTokens = parseServiceTokens(env.BUJO_SERVICE_TOKENS)
  } catch (err) {
    log(`${err instanceof Error ? err.message : String(err)} — service tokens are disabled`)
    return null
  }
  if (serviceTokens.size === 0) return null

  const team = (env.CF_ACCESS_TEAM_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const audience = (env.CF_ACCESS_AUD ?? '').trim()
  if (!team || !audience) {
    log(
      'BUJO_SERVICE_TOKENS is set, but CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are needed to verify ' +
        'service tokens — service tokens are disabled',
    )
    return null
  }
  return { issuer: `https://${team}`, audience, serviceTokens }
}

interface Jwk extends JsonWebKey {
  kid?: string
}

interface Claims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  nbf?: unknown
  common_name?: unknown
}

const KEY_TTL_MS = 60 * 60 * 1000
const KEY_REFRESH_MIN_MS = 60 * 1000
/** Tolerated clock difference between Cloudflare and this server */
const CLOCK_SKEW_S = 60

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

/**
 * Build the function that names the user behind a request, or returns null
 * when there is no acceptable identity (the caller answers 401).
 */
export function createIdentityResolver(config: AccessConfig | null, options: AuthOptions = {}) {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const log = options.log ?? console.error

  let keys = new Map<string, CryptoKey>()
  let keysFetchedAt = Number.NEGATIVE_INFINITY

  async function refreshKeys(issuer: string): Promise<void> {
    const response = await doFetch(`${issuer}/cdn-cgi/access/certs`)
    if (!response.ok) throw new Error(`fetching Access public keys: HTTP ${response.status}`)
    const body = (await response.json()) as { keys?: Jwk[] }
    const fresh = new Map<string, CryptoKey>()
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue
      fresh.set(
        jwk.kid,
        await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
      )
    }
    keys = fresh
    keysFetchedAt = now()
  }

  async function keyFor(issuer: string, kid: string): Promise<CryptoKey | null> {
    const age = now() - keysFetchedAt
    // Refetch when the cache is old, or — keys rotate — when the key is
    // unknown, but not more than once a minute for unknown ids.
    if (age > KEY_TTL_MS || (!keys.has(kid) && age > KEY_REFRESH_MIN_MS)) await refreshKeys(issuer)
    return keys.get(kid) ?? null
  }

  /** Verify an Access JWT. Returns its claims, or null if it must not be trusted. */
  async function verify(token: string, access: AccessConfig): Promise<Claims | null> {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let header: { alg?: unknown; kid?: unknown }
    let claims: Claims
    try {
      header = decodeJson(parts[0]) as typeof header
      claims = decodeJson(parts[1]) as Claims
    } catch {
      return null
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

    const key = await keyFor(access.issuer, header.kid)
    if (!key) return null
    const signed = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      new Uint8Array(Buffer.from(parts[2], 'base64url')),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    if (!signed) return null

    // A valid signature is not enough: it must be a token for this application.
    const nowS = now() / 1000
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== access.issuer) return null
    if (!audiences.includes(access.audience)) return null
    if (typeof claims.exp !== 'number' || claims.exp < nowS - CLOCK_SKEW_S) return null
    if (typeof claims.nbf === 'number' && claims.nbf > nowS + CLOCK_SKEW_S) return null
    return claims
  }

  return async function resolveUserId(header: (name: string) => string | undefined): Promise<string | null> {
    const email = header('cf-access-authenticated-user-email') ?? null
    // Service tokens not configured: exactly the previous behaviour.
    if (!config) return email

    const assertion = header('cf-access-jwt-assertion')
    if (!assertion) return email

    let claims: Claims | null
    try {
      claims = await verify(assertion, config)
    } catch (err) {
      log(`Could not verify Access JWT: ${err instanceof Error ? err.message : String(err)}`)
      claims = null
    }
    if (claims && typeof claims.common_name === 'string' && claims.common_name) {
      // A verified service token. Its identity comes from the allowlist and
      // from nowhere else: an email header sent along with it is ignored.
      return config.serviceTokens.get(claims.common_name) ?? null
    }
    return email
  }
}
