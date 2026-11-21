import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConfigError, authHeaders, authModes, configPath, loadConfig } from '../src/config'
import { makeCli, startFakeCouch } from './helpers'

const dir = mkdtempSync(join(tmpdir(), 'bujo-config-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function writeConfig(name: string, content: unknown, mode = 0o600): string {
  const path = join(dir, name)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  chmodSync(path, mode)
  return path
}

describe('config', () => {
  it('finds the config file under XDG_CONFIG_HOME or ~/.config', () => {
    expect(configPath({ HOME: '/home/me' })).toBe('/home/me/.config/bujo/config.json')
    expect(configPath({ HOME: '/home/me', XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/bujo/config.json')
    expect(configPath({ HOME: '/home/me', BUJO_CONFIG: '/etc/bujo.json' })).toBe('/etc/bujo.json')
    expect(configPath({ HOME: '/home/me', BUJO_CONFIG: '/etc/bujo.json' }, '/flag.json')).toBe('/flag.json')
  })

  it('works with no config file at all', () => {
    const loaded = loadConfig({ BUJO_CONFIG: join(dir, 'missing.json') })
    expect(loaded).toMatchObject({ config: {}, fileFound: false, sources: {} })
  })

  it('reads the file and lets environment variables override it', () => {
    const path = writeConfig('basic.json', {
      url: 'http://nas:5984/bujo',
      user: 'admin',
      password: 'from-file',
      userId: 'me@example.com',
      timezone: 'America/Chicago',
    })
    const loaded = loadConfig({ BUJO_CONFIG: path, BUJO_PASSWORD: 'from-env', BUJO_TZ: 'Europe/Paris' })
    expect(loaded.fileFound).toBe(true)
    expect(loaded.config).toEqual({
      url: 'http://nas:5984/bujo',
      user: 'admin',
      password: 'from-env',
      userId: 'me@example.com',
      timezone: 'Europe/Paris',
    })
    expect(loaded.sources).toEqual({ url: 'file', user: 'file', password: 'env', userId: 'file', timezone: 'env' })
  })

  it('reads every BUJO_* variable', () => {
    const { config } = loadConfig({
      BUJO_CONFIG: join(dir, 'missing.json'),
      BUJO_URL: 'https://bujo.example.com/couchdb/bujo/',
      BUJO_USER: 'u',
      BUJO_PASSWORD: 'p',
      BUJO_CF_CLIENT_ID: 'id.access',
      BUJO_CF_CLIENT_SECRET: 'secret',
      BUJO_USER_ID: 'me@example.com',
      BUJO_TZ: 'UTC',
    })
    expect(config).toEqual({
      url: 'https://bujo.example.com/couchdb/bujo',
      user: 'u',
      password: 'p',
      cfClientId: 'id.access',
      cfClientSecret: 'secret',
      userId: 'me@example.com',
      timezone: 'UTC',
    })
  })

  it('moves credentials out of the URL', () => {
    const { config } = loadConfig({ BUJO_CONFIG: join(dir, 'missing.json'), BUJO_URL: 'http://admin:p%40ss@localhost:5984/bujo' })
    expect(config).toMatchObject({ url: 'http://localhost:5984/bujo', user: 'admin', password: 'p@ss' })
  })

  it('rejects broken config', () => {
    expect(() => loadConfig({ BUJO_CONFIG: writeConfig('bad.json', '{ nope') })).toThrow(ConfigError)
    expect(() => loadConfig({ BUJO_CONFIG: writeConfig('array.json', []) })).toThrow(/JSON object/)
    expect(() => loadConfig({ BUJO_CONFIG: writeConfig('type.json', { url: 5984 }) })).toThrow(/"url" must be a string/)
    expect(() => loadConfig({ BUJO_CONFIG: join(dir, 'missing.json'), BUJO_URL: 'not a url' })).toThrow(/Invalid database URL/)
    expect(() => loadConfig({ BUJO_CONFIG: join(dir, 'missing.json'), BUJO_URL: 'ftp://host/bujo' })).toThrow(/http/)
    expect(() => loadConfig({}, join(dir, 'missing.json'))).toThrow(/not found/)
  })

  it('notices a config file with secrets that others can read', () => {
    const open = writeConfig('open.json', { url: 'http://h/bujo', password: 'x' }, 0o644)
    const closed = writeConfig('closed.json', { url: 'http://h/bujo', password: 'x' }, 0o600)
    const harmless = writeConfig('harmless.json', { url: 'http://h/bujo' }, 0o644)
    expect(loadConfig({ BUJO_CONFIG: open }).fileIsExposed).toBe(true)
    expect(loadConfig({ BUJO_CONFIG: closed }).fileIsExposed).toBe(false)
    expect(loadConfig({ BUJO_CONFIG: harmless }).fileIsExposed).toBe(false)
  })

  it('builds basic-auth and Cloudflare Access headers', () => {
    expect(authHeaders({})).toEqual({})
    expect(authModes({})).toEqual(['none'])
    expect(authHeaders({ user: 'admin', password: 'changeme' })).toEqual({ Authorization: 'Basic YWRtaW46Y2hhbmdlbWU=' })
    expect(authModes({ user: 'admin', password: 'changeme' })).toEqual(['basic'])

    const cf = { cfClientId: 'id.access', cfClientSecret: 'secret' }
    expect(authHeaders(cf)).toEqual({ 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'secret' })
    expect(authModes(cf)).toEqual(['cloudflare-access'])
    expect(Object.keys(authHeaders({ ...cf, user: 'a', password: 'b' }))).toHaveLength(3)
    expect(() => authHeaders({ cfClientId: 'id.access' })).toThrow(/both/)
  })
})

describe('bujo config', () => {
  it('shows where values come from and never prints secrets', async () => {
    const path = writeConfig('show.json', { url: 'http://nas:5984/bujo', user: 'admin', password: 'hunter2-file' })
    const { cli } = makeCli({ env: { BUJO_CONFIG: path, BUJO_CF_CLIENT_SECRET: 'hunter2-env', BUJO_CF_CLIENT_ID: 'id.access' } })

    const text = await cli('config')
    expect(text.code).toBe(0)
    expect(text.stdout).toContain(`config file     ${path}`)
    expect(text.stdout).toContain('url             http://nas:5984/bujo  [config file]')
    expect(text.stdout).toContain('password        (set, hidden)  [config file]')
    expect(text.stdout).toContain('cfClientSecret  (set, hidden)  [env BUJO_CF_CLIENT_SECRET]')
    expect(text.stdout).toContain('auth            cloudflare-access + basic')
    expect(text.stdout).not.toContain('hunter2')

    const json = await cli('config', '--json')
    expect(json.stdout).not.toContain('hunter2')
    expect(json.json()).toMatchObject({
      ok: true,
      command: 'config',
      path,
      fileFound: true,
      url: 'http://nas:5984/bujo',
      auth: ['cloudflare-access', 'basic'],
      hasPassword: true,
      hasCfClientSecret: true,
      userId: null,
      timezone: 'UTC',
      today: '2026-11-21',
    })
  })

  it('explains what to do when nothing is configured', async () => {
    // No injected database here: the CLI has to build one from the config
    const { run } = await import('../src/cli')
    let stderr = ''
    const code = await run(['today'], {
      stdout: () => {},
      stderr: (text) => (stderr += text),
      env: { BUJO_CONFIG: join(dir, 'missing.json') },
      stdinIsTTY: false,
      stdoutIsTTY: false,
      confirm: async () => false,
    })
    expect(code).toBe(1)
    expect(stderr).toContain('No database URL configured. Set BUJO_URL or create')
  })
})

describe('bujo doctor', () => {
  async function doctor(env: Record<string, string>) {
    const { run } = await import('../src/cli')
    let stdout = ''
    const code = await run(['doctor', '--json'], {
      stdout: (text) => (stdout += text),
      stderr: () => {},
      env: { BUJO_CONFIG: join(dir, 'missing.json'), BUJO_TZ: 'UTC', ...env },
      stdinIsTTY: false,
      stdoutIsTTY: false,
      confirm: async () => false,
    })
    const report = JSON.parse(stdout) as { ok: boolean; checks: { name: string; status: string; detail: string }[] }
    return { code, report, status: Object.fromEntries(report.checks.map((c) => [c.name, c.status])) }
  }

  it('passes against a reachable database', async () => {
    const couch = await startFakeCouch({ requireHeaders: { authorization: 'Basic YWRtaW46Y2hhbmdlbWU=' } })
    try {
      const { code, report, status } = await doctor({
        BUJO_URL: couch.url, BUJO_USER: 'admin', BUJO_PASSWORD: 'changeme', BUJO_USER_ID: 'me@example.com',
      })
      expect(code).toBe(0)
      expect(report.ok).toBe(true)
      expect(status).toEqual({ config: 'ok', timezone: 'ok', url: 'ok', read: 'ok', write: 'ok', userId: 'ok' })
      // The write check must not have written anything
      expect((await couch.db.info()).doc_count).toBe(0)
    } finally {
      await couch.close()
    }
  })

  it('fails with exit code 1 on wrong credentials, and warns about a missing userId', async () => {
    const couch = await startFakeCouch({ requireHeaders: { authorization: 'Basic YWRtaW46Y2hhbmdlbWU=' } })
    try {
      const { code, report, status } = await doctor({ BUJO_URL: couch.url, BUJO_USER: 'admin', BUJO_PASSWORD: 'wrong' })
      expect(code).toBe(1)
      expect(report.ok).toBe(false)
      expect(status).toMatchObject({ url: 'ok', read: 'fail', userId: 'warn' })
      expect(report.checks.find((c) => c.name === 'read')?.detail).toContain('refused the credentials')
    } finally {
      await couch.close()
    }
  })

  it('fails when nothing is configured or the timezone is bogus', async () => {
    const { code, status } = await doctor({ BUJO_TZ: 'Mars/Phobos' })
    expect(code).toBe(1)
    expect(status).toMatchObject({ config: 'ok', timezone: 'fail', url: 'fail' })
  })
})
