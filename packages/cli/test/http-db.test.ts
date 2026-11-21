import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBujo, refOf, type BujoEntry, type GhostEntry } from '@bujo/core'
import { fakeClock } from '../../core/test/helpers'
import { AuthError, ConnectionError, HttpDbError, createHttpDb, type HttpDb } from '../src/http-db'
import { startFakeCouch, type FakeCouch } from './helpers'

// These run against the built-in fake CouchDB, and also against a real one
// when BUJO_TEST_COUCH_URL points at a server (with admin credentials), e.g.
//   docker compose -f docker-compose.dev.yml up -d
//   BUJO_TEST_COUCH_URL=http://admin:changeme@localhost:5984 npm test
const REAL = process.env.BUJO_TEST_COUCH_URL

interface Backend {
  name: string
  start(): Promise<{ db: HttpDb; stop(): Promise<void> }>
}

const backends: Backend[] = [
  {
    name: 'fake CouchDB',
    async start() {
      const couch = await startFakeCouch()
      return { db: createHttpDb({ url: couch.url }), stop: () => couch.close() }
    },
  },
]

if (REAL) {
  backends.push({
    name: 'real CouchDB',
    async start() {
      const server = new URL(REAL)
      const auth = `Basic ${Buffer.from(`${decodeURIComponent(server.username)}:${decodeURIComponent(server.password)}`).toString('base64')}`
      server.username = ''
      server.password = ''
      const url = `${server.toString().replace(/\/+$/, '')}/bujo_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const headers = { Authorization: auth }
      const created = await fetch(url, { method: 'PUT', headers })
      if (!created.ok) throw new Error(`Could not create test database: HTTP ${created.status}`)
      return {
        db: createHttpDb({ url, headers }),
        stop: async () => {
          await fetch(url, { method: 'DELETE', headers })
        },
      }
    },
  })
}

describe.each(backends)('HTTP database client against $name', ({ start }) => {
  let db: HttpDb
  let stop: () => Promise<void>

  beforeAll(async () => {
    ;({ db, stop } = await start())
  })
  afterAll(() => stop())

  it('reads database info', async () => {
    const info = await db.info()
    expect(info.db_name).toMatch(/^bujo/)
    expect(typeof info.doc_count).toBe('number')
  })

  it('puts, gets and removes documents whose ids need escaping', async () => {
    const id = '~unscheduled:1795000000000:abc123'
    const written = await db.put({ _id: id, type: 'entry', body: 'héllo #tag / ?' } as never)
    expect(written).toMatchObject({ ok: true, id })

    const doc = (await db.get(id)) as { _id: string; _rev: string; body: string }
    expect(doc).toMatchObject({ _id: id, _rev: written.rev, body: 'héllo #tag / ?' })

    await db.remove(id, doc._rev)
    await expect(db.get(id)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects stale writes with a 409 conflict', async () => {
    const id = '2026-01-01:1:confl1'
    const first = await db.put({ _id: id, n: 1 } as never)
    await db.put({ _id: id, _rev: first.rev, n: 2 } as never)

    const stale = db.put({ _id: id, _rev: first.rev, n: 3 } as never)
    await expect(stale).rejects.toBeInstanceOf(HttpDbError)
    await expect(stale).rejects.toMatchObject({ status: 409, name: 'conflict' })
    await expect(db.put({ _id: id, n: 4 } as never)).rejects.toMatchObject({ status: 409 })
    await expect(db.remove(id, first.rev!)).rejects.toMatchObject({ status: 409 })
  })

  it('lets a deleted id be written again without a revision', async () => {
    const id = '2026-01-02:1:reborn'
    const first = await db.put({ _id: id, n: 1 } as never)
    await db.remove(id, first.rev!)
    const second = await db.put({ _id: id, n: 2 } as never)
    expect(second.ok).toBe(true)
    expect(await db.get(id)).toMatchObject({ n: 2 })
  })

  it('queries ranges and explicit keys', async () => {
    await db.bulkDocs(['2026-02-01:1:aaaaaa', '2026-02-02:1:bbbbbb', '2026-02-03:1:cccccc', '2026-02:1:dddddd'].map((_id) => ({ _id })))

    const range = await db.allDocs({ include_docs: true, startkey: '2026-02-01:', endkey: '2026-02-02:￰' })
    expect(range.rows.map((r) => r.id)).toEqual(['2026-02-01:1:aaaaaa', '2026-02-02:1:bbbbbb'])
    expect(range.rows[0].doc).toMatchObject({ _id: '2026-02-01:1:aaaaaa' })

    // A month key sorts after the days of its month
    const month = await db.allDocs({ startkey: '2026-02-', endkey: '2026-02:￰' })
    expect(month.rows.map((r) => r.id).at(-1)).toBe('2026-02:1:dddddd')

    const keyed = await db.allDocs({ include_docs: true, keys: ['2026-02-03:1:cccccc', 'no-such-doc', '2026-02-01:1:aaaaaa'] })
    expect(keyed.rows.map((r) => r.id)).toEqual(['2026-02-03:1:cccccc', '2026-02-01:1:aaaaaa'])

    const before = await db.allDocs({ endkey: '2026-02-02:' })
    expect(before.rows.map((r) => r.id)).toContain('2026-02-01:1:aaaaaa')
    expect(before.rows.map((r) => r.id)).not.toContain('2026-02-02:1:bbbbbb')
  })

  it('reports per-document conflicts from bulk writes', async () => {
    const [created] = await db.bulkDocs([{ _id: '2026-03-01:1:bulk01' }])
    expect(created).toMatchObject({ ok: true, id: '2026-03-01:1:bulk01' })

    const results = await db.bulkDocs([{ _id: '2026-03-01:1:bulk01' }, { _id: '2026-03-01:1:bulk02' }])
    expect(results[0]).toMatchObject({ id: '2026-03-01:1:bulk01', status: 409, name: 'conflict' })
    expect(results[0].error).toBeTruthy()
    expect(results[1]).toMatchObject({ ok: true, id: '2026-03-01:1:bulk02' })
    expect(await db.bulkDocs([])).toEqual([])
  })

  it('runs the whole domain logic: moves, ghosts, conflicts, stable refs', async () => {
    const bujo = createBujo(db, { userId: 'me@example.com', now: fakeClock() })
    const entry = await bujo.addEntry('2026-05-01', 'task', 'Over HTTP #remote', { priority: true })
    const ref = refOf(entry._id)

    // Away, back, and away again: reuses ids that were deleted in between
    const b = await bujo.rescheduleEntry(entry, '2026-05-02')
    const a = await bujo.rescheduleEntry(b, '2026-05-01')
    const c = await bujo.rescheduleEntry(a, '2026-05-02')
    expect(refOf(c._id)).toBe(ref)
    expect(c).toMatchObject({ dateHistory: ['2026-05-01', '2026-05-02', '2026-05-01'], priority: true, userId: 'me@example.com' })

    const day1 = await bujo.getEntriesForDate('2026-05-01')
    expect(day1.map((d) => [refOf(d.entry._id), d.isGhost])).toEqual([[ref, true]])
    expect((day1[0].ghostDoc as GhostEntry).userId).toBe('me@example.com')
    expect((await bujo.getEntriesForDate('2026-05-02')).map((d) => d.isGhost)).toEqual([false])

    // Stale copies still work: the change lands on the latest revision,
    // even through the original from three moves ago
    const completed = await bujo.completeEntry(entry as BujoEntry)
    expect(completed).toMatchObject({ _id: c._id, status: 'completed' })
    const edited = await bujo.updateEntry(c, { body: 'Over HTTP, edited #remote' }) // c is stale now
    expect(edited).toMatchObject({ status: 'completed', body: 'Over HTTP, edited #remote' })

    expect((await bujo.getEntriesForTag('remote')).map((e) => refOf(e._id))).toEqual([ref])
    await bujo.deleteEntry(edited)
    expect(await bujo.getEntriesForDate('2026-05-01')).toEqual([])
  })
})

describe('HTTP database client: authentication and failures', () => {
  let couch: FakeCouch
  afterAll(() => couch?.close())

  it('sends the configured headers with every request', async () => {
    couch = await startFakeCouch({ requireHeaders: { 'cf-access-client-id': 'abc.access', 'cf-access-client-secret': 's3cret' } })
    const db = createHttpDb({
      url: couch.url,
      headers: { 'CF-Access-Client-Id': 'abc.access', 'CF-Access-Client-Secret': 's3cret' },
    })
    await db.info()
    await db.put({ _id: '2026-01-01:1:authok' })
    await db.allDocs({ keys: ['2026-01-01:1:authok'] })
    expect(couch.requests).toHaveLength(3)
    for (const request of couch.requests) {
      expect(request.headers['cf-access-client-id']).toBe('abc.access')
    }
  })

  it('turns 401 into an AuthError', async () => {
    const db = createHttpDb({ url: couch.url, headers: { 'CF-Access-Client-Id': 'wrong' } })
    await expect(db.info()).rejects.toBeInstanceOf(AuthError)
    await expect(db.info()).rejects.toThrow(/refused the credentials \(HTTP 401\)/)
  })

  it('does not follow a redirect to a login page', async () => {
    const wall = await startFakeCouch({ behaviour: 'redirect' })
    try {
      const db = createHttpDb({ url: wall.url })
      await expect(db.info()).rejects.toBeInstanceOf(AuthError)
      await expect(db.info()).rejects.toThrow(/Service Auth policy/)
      expect(wall.requests.every((r) => r.path === '/bujo')).toBe(true)
    } finally {
      await wall.close()
    }
  })

  it('recognises an HTML page as not being a database', async () => {
    const wall = await startFakeCouch({ behaviour: 'html' })
    try {
      await expect(createHttpDb({ url: wall.url }).info()).rejects.toThrow(/did not answer with JSON/)
    } finally {
      await wall.close()
    }
  })

  it('reports an unreachable server as a ConnectionError', async () => {
    const gone = await startFakeCouch()
    await gone.close()
    const db = createHttpDb({ url: gone.url })
    await expect(db.info()).rejects.toBeInstanceOf(ConnectionError)
    await expect(db.info()).rejects.toThrow(/Cannot reach 127\.0\.0\.1:\d+/)
  })

  it('gives up after the timeout', async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    const db = createHttpDb({ url: 'http://slow.example/bujo', timeoutMs: 20, fetch: never })
    await expect(db.info()).rejects.toThrow(/No answer from slow\.example after 0\.02s/)
  })
})
