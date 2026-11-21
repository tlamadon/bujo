import { beforeAll, describe, expect, it } from 'vitest'
import { createIdentityResolver, loadAccessConfig, parseServiceTokens, type AccessConfig } from '../src/auth.js'

const ISSUER = 'https://myteam.cloudflareaccess.com'
const AUD = '32eafc7626e974616deaf0dc3ce63d7bcbed58a2731e84d06bc3cdf1b53c4228'
const CLIENT_ID = 'e367826f93b8d71185e03fe518aff3b4.access'
const NOW = Date.UTC(2026, 10, 21, 18, 0, 0)
const NOW_S = NOW / 1000

const config: AccessConfig = {
  issuer: ISSUER,
  audience: AUD,
  serviceTokens: new Map([[CLIENT_ID, 'me@example.com']]),
}

interface KeyPair {
  kid: string
  privateKey: CryptoKey
  jwk: JsonWebKey & { kid: string }
}

async function makeKey(kid: string): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } }
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

async function sign(key: KeyPair, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = b64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })
  const body = b64(claims)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`
}

/** What Cloudflare puts in the JWT for a service token (per its docs). */
function serviceClaims(overrides: Record<string, unknown> = {}) {
  return { type: 'app', aud: [AUD], exp: NOW_S + 60, iat: NOW_S, iss: ISSUER, common_name: CLIENT_ID, sub: '', ...overrides }
}

/** …and for a person who logged in through an identity provider. */
function browserClaims(overrides: Record<string, unknown> = {}) {
  return {
    type: 'app', aud: [AUD], exp: NOW_S + 3600, iat: NOW_S, nbf: NOW_S, iss: ISSUER,
    email: 'me@example.com', sub: '7335d417-61da-459d-899c-0a01c76a2f94', country: 'US', ...overrides,
  }
}

let key: KeyPair
let otherKey: KeyPair

beforeAll(async () => {
  key = await makeKey('key-1')
  otherKey = await makeKey('key-2')
})

/** A resolver whose JWKS endpoint serves `keys`; counts how often it is asked. */
function setup(options: { config?: AccessConfig | null; keys?: () => KeyPair[]; now?: () => number } = {}) {
  const fetched: string[] = []
  const errors: string[] = []
  const serve = options.keys ?? (() => [key])
  const resolve = createIdentityResolver(options.config === undefined ? config : options.config, {
    now: options.now ?? (() => NOW),
    log: (message) => errors.push(message),
    fetch: (async (url: string) => {
      fetched.push(String(url))
      return new Response(JSON.stringify({ keys: serve().map((k) => k.jwk) }), { status: 200 })
    }) as typeof fetch,
  })
  const identify = (headers: Record<string, string>) => resolve((name) => headers[name.toLowerCase()])
  return { identify, fetched, errors }
}

describe('service token mapping', () => {
  it('parses clientId=userId pairs', () => {
    expect([...parseServiceTokens('a.access=me@example.com, b.access = you@example.com ,')]).toEqual([
      ['a.access', 'me@example.com'],
      ['b.access', 'you@example.com'],
    ])
    expect(parseServiceTokens(undefined).size).toBe(0)
    expect(parseServiceTokens('  ').size).toBe(0)
  })

  it('rejects malformed pairs', () => {
    expect(() => parseServiceTokens('a.access')).toThrow(/clientId=userId/)
    expect(() => parseServiceTokens('a.access=')).toThrow(/clientId=userId/)
    expect(() => parseServiceTokens('=me@example.com')).toThrow(/clientId=userId/)
  })

  it('is off unless tokens, team domain and audience are all configured', () => {
    const log: string[] = []
    expect(loadAccessConfig({}, (m) => log.push(m))).toBeNull()
    expect(log).toEqual([]) // nothing configured is not worth a warning

    const tokens = { BUJO_SERVICE_TOKENS: `${CLIENT_ID}=me@example.com` }
    expect(loadAccessConfig(tokens, (m) => log.push(m))).toBeNull()
    expect(loadAccessConfig({ ...tokens, CF_ACCESS_TEAM_DOMAIN: 'myteam.cloudflareaccess.com' }, (m) => log.push(m))).toBeNull()
    expect(loadAccessConfig({ ...tokens, CF_ACCESS_AUD: AUD }, (m) => log.push(m))).toBeNull()
    expect(log).toHaveLength(3)
    expect(log[0]).toContain('service tokens are disabled')

    expect(loadAccessConfig({ BUJO_SERVICE_TOKENS: 'garbage', CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: AUD }, (m) => log.push(m))).toBeNull()
  })

  it('normalises the team domain into the issuer URL', () => {
    for (const domain of ['myteam.cloudflareaccess.com', 'https://myteam.cloudflareaccess.com/', ' myteam.cloudflareaccess.com ']) {
      const loaded = loadAccessConfig({
        BUJO_SERVICE_TOKENS: `${CLIENT_ID}=me@example.com`,
        CF_ACCESS_TEAM_DOMAIN: domain,
        CF_ACCESS_AUD: AUD,
      })
      expect(loaded).toMatchObject({ issuer: ISSUER, audience: AUD })
      expect(loaded?.serviceTokens.get(CLIENT_ID)).toBe('me@example.com')
    }
  })
})

describe('browser requests (unchanged)', () => {
  it('uses the Cloudflare email header when service tokens are not configured', async () => {
    const { identify, fetched } = setup({ config: null })
    expect(await identify({ 'cf-access-authenticated-user-email': 'me@example.com' })).toBe('me@example.com')
    expect(await identify({})).toBeNull()
    // A service-token JWT means nothing when the feature is off
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims()) })).toBeNull()
    expect(fetched).toEqual([])
  })

  it('still uses the email header when service tokens are configured', async () => {
    const { identify } = setup()
    expect(await identify({ 'cf-access-authenticated-user-email': 'me@example.com' })).toBe('me@example.com')
    expect(
      await identify({
        'cf-access-authenticated-user-email': 'me@example.com',
        'cf-access-jwt-assertion': await sign(key, browserClaims()),
      }),
    ).toBe('me@example.com')
    expect(await identify({})).toBeNull()
  })

  it('keeps working for browsers if the JWT cannot be verified', async () => {
    const { identify, errors } = setup({ keys: () => { throw new Error('certs endpoint down') } })
    const headers = {
      'cf-access-authenticated-user-email': 'me@example.com',
      'cf-access-jwt-assertion': await sign(key, browserClaims()),
    }
    expect(await identify(headers)).toBe('me@example.com')
    expect(errors[0]).toContain('Could not verify Access JWT')
  })
})

describe('service tokens', () => {
  it('maps a verified service token to its configured user', async () => {
    const { identify, fetched } = setup()
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims()) })).toBe('me@example.com')
    expect(fetched).toEqual([`${ISSUER}/cdn-cgi/access/certs`])
  })

  it('accepts an audience given as a string', async () => {
    const { identify } = setup()
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims({ aud: AUD })) })).toBe('me@example.com')
  })

  it('rejects a verified token that is not in the allowlist', async () => {
    const { identify } = setup()
    const token = await sign(key, serviceClaims({ common_name: 'someone-else.access' }))
    expect(await identify({ 'cf-access-jwt-assertion': token })).toBeNull()
  })

  it('ignores an email header sent along with a service token', async () => {
    const { identify } = setup()
    const spoofed = 'admin@example.com'
    expect(
      await identify({
        'cf-access-authenticated-user-email': spoofed,
        'cf-access-jwt-assertion': await sign(key, serviceClaims()),
      }),
    ).toBe('me@example.com')
    // …and an unmapped token cannot borrow an identity that way either
    expect(
      await identify({
        'cf-access-authenticated-user-email': spoofed,
        'cf-access-jwt-assertion': await sign(key, serviceClaims({ common_name: 'unmapped.access' })),
      }),
    ).toBeNull()
  })

  it.each([
    ['a different application', { aud: ['some-other-aud'] }],
    ['a different team', { iss: 'https://evil.cloudflareaccess.com' }],
    ['an expired token', { exp: NOW_S - 300 }],
    ['a token without expiry', { exp: undefined }],
    ['a token not valid yet', { nbf: NOW_S + 600 }],
  ])('rejects %s', async (_name, overrides) => {
    const { identify } = setup()
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims(overrides)) })).toBeNull()
  })

  it('tolerates a little clock skew', async () => {
    const { identify } = setup()
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims({ exp: NOW_S - 30 })) })).toBe('me@example.com')
  })

  it('rejects tokens that are not properly signed', async () => {
    const { identify } = setup()
    const good = await sign(key, serviceClaims())
    const [head, , signature] = good.split('.')

    // Signed by a key the team never published
    expect(await identify({ 'cf-access-jwt-assertion': await sign({ ...otherKey, kid: 'key-1' }, serviceClaims()) })).toBeNull()
    // Claims swapped after signing
    const tampered = `${head}.${b64(serviceClaims({ common_name: CLIENT_ID, exp: NOW_S + 9999 }))}.${signature}`
    expect(await identify({ 'cf-access-jwt-assertion': tampered })).toBeNull()
    // "alg: none" and friends
    expect(await identify({ 'cf-access-jwt-assertion': `${b64({ alg: 'none', kid: 'key-1' })}.${b64(serviceClaims())}.` })).toBeNull()
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims(), { alg: 'HS256' }) })).toBeNull()
    // Not a JWT at all
    for (const junk of ['', 'abc', 'a.b', 'a.b.c', '!!!.???.***']) {
      expect(await identify({ 'cf-access-jwt-assertion': junk }), junk).toBeNull()
    }
  })

  it('caches the public keys and picks up rotated ones', async () => {
    let published = [key]
    let time = NOW
    const { identify, fetched } = setup({ keys: () => published, now: () => time })
    const first = await sign(key, serviceClaims())

    expect(await identify({ 'cf-access-jwt-assertion': first })).toBe('me@example.com')
    expect(await identify({ 'cf-access-jwt-assertion': first })).toBe('me@example.com')
    expect(fetched).toHaveLength(1)

    // Cloudflare rotates: a token signed with a key we have not seen
    published = [key, otherKey]
    const rotated = await sign(otherKey, serviceClaims())
    // Unknown key ids do not trigger a refetch more than once a minute
    expect(await identify({ 'cf-access-jwt-assertion': rotated })).toBeNull()
    expect(fetched).toHaveLength(1)
    time += 61_000
    expect(await identify({ 'cf-access-jwt-assertion': await sign(otherKey, serviceClaims({ exp: time / 1000 + 60 })) })).toBe('me@example.com')
    expect(fetched).toHaveLength(2)

    // The cache expires after an hour
    time += 61 * 60 * 1000
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims({ exp: time / 1000 + 60 })) })).toBe('me@example.com')
    expect(fetched).toHaveLength(3)
  })

  it('fails closed for service tokens when the keys cannot be fetched', async () => {
    const { identify, errors } = setup({ keys: () => { throw new Error('certs endpoint down') } })
    expect(await identify({ 'cf-access-jwt-assertion': await sign(key, serviceClaims()) })).toBeNull()
    expect(errors).toHaveLength(1)
  })
})
