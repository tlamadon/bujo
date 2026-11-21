import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBujo, type AnyDoc, type BujoDb } from '@bujo/core'
import { fakeClock, newDb } from '../../core/test/helpers'
import { run } from '../src/cli'

export { newDb }

export interface CliResult {
  code: number
  stdout: string
  stderr: string
  /** stdout parsed as JSON */
  json: () => Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** stderr parsed as JSON */
  errorJson: () => Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface CliOptions {
  db?: BujoDb
  env?: Record<string, string>
  /** Pretend stdin is a terminal */
  tty?: boolean
  /** Answer given to confirmation prompts */
  answer?: boolean
}

/**
 * The CLI running in-process against an in-memory database, with a fixed
 * clock: it is 2026-11-21 (a Saturday, ISO week 47) in UTC.
 */
export function makeCli(options: CliOptions = {}) {
  const db = options.db ?? newDb()
  const now = fakeClock()
  const questions: string[] = []
  const env = { BUJO_CONFIG: '/nonexistent/bujo/config.json', BUJO_TZ: 'UTC', ...options.env }

  async function cli(...args: string[]): Promise<CliResult> {
    let stdout = ''
    let stderr = ''
    const code = await run(args, {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      env,
      stdinIsTTY: !!options.tty,
      stdoutIsTTY: false,
      confirm: async (question) => {
        questions.push(question)
        return !!options.answer
      },
      now,
      db,
    })
    return { code, stdout, stderr, json: () => JSON.parse(stdout), errorJson: () => JSON.parse(stderr) }
  }

  /** Run a command with --json, expect success, return the parsed output. */
  async function ok(...args: string[]) {
    const result = await cli(...args, '--json')
    if (result.code !== 0) throw new Error(`bujo ${args.join(' ')} exited ${result.code}: ${result.stderr}`)
    return result.json()
  }

  return { cli, ok, db, bujo: createBujo(db, { now }), questions }
}

// ─── A fake CouchDB ────────────────────────────────────────────────

export interface FakeCouch {
  /** Database URL, e.g. http://127.0.0.1:41234/bujo */
  url: string
  db: PouchDB.Database<AnyDoc>
  requests: { method: string; path: string; headers: IncomingMessage['headers'] }[]
  close(): Promise<void>
}

export interface FakeCouchOptions {
  /** Requests lacking these headers get a 401 */
  requireHeaders?: Record<string, string>
  /** Answer every request like a login wall instead of a database */
  behaviour?: 'redirect' | 'html'
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * Enough of CouchDB's HTTP API, backed by an in-memory PouchDB, to exercise
 * the CLI's HTTP client end to end without Docker.
 */
export async function startFakeCouch(options: FakeCouchOptions = {}): Promise<FakeCouch> {
  const db = newDb()
  const requests: FakeCouch['requests'] = []

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push({ method: req.method ?? '', path: url.pathname + url.search, headers: req.headers })
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (options.behaviour === 'redirect') {
      res.writeHead(302, { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' })
      res.end()
      return
    }
    if (options.behaviour === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Sign in</body></html>')
      return
    }
    for (const [name, value] of Object.entries(options.requireHeaders ?? {})) {
      if (req.headers[name.toLowerCase()] !== value) {
        send(401, { error: 'unauthorized', reason: 'Name or password is incorrect.' })
        return
      }
    }

    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : undefined
      const [dbName, ...rest] = url.pathname.split('/').filter(Boolean)
      if (dbName !== 'bujo') {
        send(404, { error: 'not_found', reason: 'Database does not exist.' })
        return
      }
      if (rest.length === 0) {
        const info = await db.info()
        send(200, { db_name: 'bujo', doc_count: info.doc_count })
        return
      }
      if (rest[0] === '_all_docs') {
        const param = (name: string) => {
          const value = url.searchParams.get(name)
          return value === null ? undefined : JSON.parse(value)
        }
        const query: PouchDB.Core.AllDocsOptions & { keys?: string[] } = {
          include_docs: url.searchParams.get('include_docs') === 'true',
        }
        if (param('startkey') !== undefined) Object.assign(query, { startkey: param('startkey') })
        if (param('endkey') !== undefined) Object.assign(query, { endkey: param('endkey') })
        if (body?.keys) query.keys = body.keys
        send(200, await db.allDocs(query))
        return
      }
      if (rest[0] === '_bulk_docs') {
        const results = await db.bulkDocs(body.docs)
        send(
          201,
          results.map((r) =>
            'error' in r && r.error ? { id: r.id, error: r.name, reason: r.message } : r,
          ),
        )
        return
      }
      const id = decodeURIComponent(rest.join('/'))
      if (req.method === 'GET') send(200, await db.get(id))
      else if (req.method === 'PUT') send(201, await db.put({ ...body, _id: id }))
      else if (req.method === 'DELETE') send(200, await db.remove(id, url.searchParams.get('rev') ?? ''))
      else send(405, { error: 'method_not_allowed', reason: 'nope' })
    } catch (err) {
      const e = err as { status?: number; name?: string; message?: string }
      send(e.status ?? 500, { error: e.name ?? 'error', reason: e.message ?? 'failed' })
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/bujo`,
    db,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
