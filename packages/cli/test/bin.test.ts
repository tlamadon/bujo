import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCouch, type FakeCouch } from './helpers'

// The real thing: the bundled binary, run as a separate process, talking
// HTTP to a (fake) CouchDB and configured through a file and the environment.

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'bujo-bin-test-'))
const bin = join(dir, 'bujo.cjs')
const AUTH = 'Basic YWRtaW46Y2hhbmdlbWU=' // admin:changeme

let couch: FakeCouch
let configFile: string

// Asynchronous on purpose: the fake CouchDB lives in this process, so the
// event loop has to keep turning while the binary runs.
function bujo(args: string[], env: Record<string, string> = {}, input = '') {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: dir,
        BUJO_CONFIG: configFile,
        BUJO_NOW: '2026-11-21T18:00:00Z',
        BUJO_TZ: 'UTC',
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

beforeAll(async () => {
  const built = spawnSync(process.execPath, [join(cliDir, 'build.mjs'), bin], { encoding: 'utf8' })
  if (built.status !== 0) throw new Error(`CLI build failed:\n${built.stderr}`)

  couch = await startFakeCouch({ requireHeaders: { authorization: AUTH } })
  configFile = join(dir, 'config.json')
  writeFileSync(
    configFile,
    JSON.stringify({ url: couch.url, user: 'admin', password: 'changeme', userId: 'me@example.com' }),
  )
  chmodSync(configFile, 0o600)
}, 60_000)

afterAll(async () => {
  await couch?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the bujo binary', () => {
  it('is a self-contained executable', async () => {
    const version = await bujo(['--version'])
    expect(version.code).toBe(0)
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect((await bujo(['--help'])).stdout).toContain('Usage: bujo')
  })

  it('captures, lists and completes over HTTP, stamping userId', async () => {
    const added = await bujo(['add', 'Call plumber #house', '--priority', '--json'])
    expect(added.code).toBe(0)
    expect(added.stderr).toBe('')
    const { entry } = JSON.parse(added.stdout)
    expect(entry).toMatchObject({ body: 'Call plumber #house', date: '2026-11-21', priority: true })

    const stored = await couch.db.get(entry.id)
    expect(stored).toMatchObject({ type: 'entry', userId: 'me@example.com', tags: ['house'] })
    expect(await couch.db.get('tag:house')).toMatchObject({ userId: 'me@example.com' })

    const today = await bujo(['today'])
    expect(today.code).toBe(0)
    expect(today.stdout).toBe(`Sat 21 Nov 2026 · today · 2026-W47\n\n  ${entry.ref}  *• Call plumber #house\n`)

    expect((await bujo(['done', 'plumber'])).stdout).toBe(`done  ${entry.ref}  *× Call plumber #house\n`)
    expect(await couch.db.get(entry.id)).toMatchObject({ status: 'completed' })
  })

  it('moves an entry and keeps its ref', async () => {
    const { entry } = JSON.parse((await bujo(['add', 'Renew passport', '--json'])).stdout)
    const moved = JSON.parse((await bujo(['move', entry.ref, '+3d', '--json'])).stdout)
    expect(moved.entry).toMatchObject({ ref: entry.ref, date: '2026-11-24', moves: 1 })
    await expect(couch.db.get(entry.id)).rejects.toMatchObject({ status: 404 })
    expect(await couch.db.get(moved.entry.id)).toMatchObject({ dateHistory: ['2026-11-21'] })
  })

  it('exits 2 with the message on stderr when a reference does not resolve', async () => {
    const missing = await bujo(['done', 'no-such-entry'])
    expect(missing).toEqual({ code: 2, stdout: '', stderr: 'error: No entry matches "no-such-entry"\n' })

    await bujo(['add', 'Call mum'])
    await bujo(['add', 'Call dad'])
    const ambiguous = await bujo(['done', 'call', '--json'])
    expect(ambiguous.code).toBe(2)
    expect(ambiguous.stdout).toBe('')
    expect(JSON.parse(ambiguous.stderr).error).toMatchObject({ code: 'ambiguous' })
  })

  it('exits 1 on usage errors', async () => {
    const result = await bujo(['add', 'x', '--date', 'whenever'])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unrecognized date "whenever"')
  })

  it('never prompts without a terminal: rm needs --yes', async () => {
    const { entry } = JSON.parse((await bujo(['add', 'Disposable', '--json'])).stdout)
    // stdin is a pipe here, and even says "y"
    const refused = await bujo(['rm', entry.ref], {}, 'y\n')
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('without --yes')
    expect(await couch.db.get(entry.id)).toBeTruthy()

    expect((await bujo(['rm', entry.ref, '--yes'])).code).toBe(0)
    await expect(couch.db.get(entry.id)).rejects.toMatchObject({ status: 404 })
  })

  it('lets the environment override the config file', async () => {
    const wrong = await bujo(['today'], { BUJO_PASSWORD: 'wrong' })
    expect(wrong.code).toBe(1)
    expect(wrong.stderr).toMatch(/^error: 127\.0\.0\.1:\d+ refused the credentials \(HTTP 401\)/)
    expect(wrong.stderr).not.toContain('wrong')

    const down = await bujo(['today'], { BUJO_URL: 'http://127.0.0.1:1/bujo' })
    expect(down.code).toBe(1)
    expect(down.stderr).toContain('Cannot reach 127.0.0.1:1')
  })

  it('reports a healthy setup from doctor', async () => {
    const result = await bujo(['doctor'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ok    write')
    expect(result.stdout).not.toContain('changeme')
  })

  it('accepts a pinned clock and a timezone', async () => {
    const late = { BUJO_NOW: '2026-11-22T03:30:00Z' }
    expect(JSON.parse((await bujo(['today', '--json'], late)).stdout).date).toBe('2026-11-22')
    expect(JSON.parse((await bujo(['today', '--json'], { ...late, BUJO_TZ: 'America/Chicago' })).stdout).date).toBe('2026-11-21')
    expect(JSON.parse((await bujo(['today', '--json', '--tz', 'Asia/Tokyo'], late)).stdout).date).toBe('2026-11-22')
  })
})
