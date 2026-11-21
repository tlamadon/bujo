import type { AllDocsOptions, BujoDb, DbRow, DbWriteResult, StoredDoc } from '@bujo/core'

/** A failed request to the database. `status` mirrors the HTTP status. */
export class HttpDbError extends Error {
  readonly status: number
  /** CouchDB's error slug (`conflict`, `not_found`, …) when there is one */
  readonly error: string

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = error || 'HttpDbError'
    this.status = status
    this.error = error
  }
}

/** The server could not be reached at all. */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/** The server answered, but not as an authenticated CouchDB would. */
export class AuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

export interface HttpDbOptions {
  /** Database URL without credentials, e.g. `http://host:5984/bujo` */
  url: string
  /** Sent with every request (authentication) */
  headers?: Record<string, string>
  /** Per-request timeout in milliseconds (default 30s) */
  timeoutMs?: number
  fetch?: typeof fetch
}

export interface DbInfo {
  db_name: string
  doc_count: number
}

export interface HttpDb extends BujoDb {
  /** Database metadata; the cheapest way to check the connection */
  info(): Promise<DbInfo>
}

/**
 * A minimal CouchDB client implementing the database interface core needs.
 * It talks to the remote directly — no local replica — and works both
 * against CouchDB itself and through the Hono `/couchdb` proxy.
 */
export function createHttpDb(options: HttpDbOptions): HttpDb {
  const base = options.url.replace(/\/+$/, '')
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const host = new URL(base).host

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect means a login page (Cloudflare Access): never follow it.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err)
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      throw new ConnectionError(
        timedOut ? `No answer from ${host} after ${timeoutMs / 1000}s` : `Cannot reach ${host}: ${cause}`,
      )
    }

    if (response.status >= 300 && response.status < 400) {
      throw new AuthError(
        response.status,
        `${host} redirected the request (HTTP ${response.status}) — it wants a browser login. ` +
          'Check the Cloudflare Access service token and that the application has a Service Auth policy',
      )
    }

    const text = await response.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = undefined
    }

    if (response.status === 401 || response.status === 403) {
      const reason = (json as { reason?: string; error?: string } | null)?.reason ?? ''
      throw new AuthError(
        response.status,
        `${host} refused the credentials (HTTP ${response.status})${reason ? `: ${reason}` : ''}`,
      )
    }
    if (json === undefined) {
      throw new AuthError(
        response.status,
        `${host} did not answer with JSON (HTTP ${response.status}) — is the URL a CouchDB database?`,
      )
    }
    if (!response.ok) {
      const info = (json ?? {}) as { error?: string; reason?: string }
      throw new HttpDbError(
        response.status,
        info.error ?? '',
        info.reason ?? info.error ?? `HTTP ${response.status}`,
      )
    }
    return json
  }

  const docPath = (id: string) => `/${encodeURIComponent(id)}`

  return {
    async info() {
      return (await request('GET', '')) as DbInfo
    },

    get(id) {
      return request('GET', docPath(id))
    },

    async put(doc: StoredDoc) {
      return (await request('PUT', docPath(doc._id), doc)) as DbWriteResult
    },

    async remove(id, rev) {
      return (await request('DELETE', `${docPath(id)}?rev=${encodeURIComponent(rev)}`)) as DbWriteResult
    },

    async allDocs(opts: AllDocsOptions = {}) {
      const query = new URLSearchParams()
      if (opts.include_docs) query.set('include_docs', 'true')
      if (opts.startkey !== undefined) query.set('startkey', JSON.stringify(opts.startkey))
      if (opts.endkey !== undefined) query.set('endkey', JSON.stringify(opts.endkey))
      const suffix = query.size > 0 ? `?${query}` : ''
      const result = opts.keys
        ? await request('POST', `/_all_docs${suffix}`, { keys: opts.keys })
        : await request('GET', `/_all_docs${suffix}`)
      // Rows for unknown keys have no id; core only wants documents that exist
      const rows = (result as { rows: (Partial<DbRow> & { doc?: unknown })[] }).rows
      return { rows: rows.filter((r): r is DbRow => typeof r.id === 'string' && !(opts.include_docs && !r.doc)) }
    },

    async bulkDocs(docs: StoredDoc[]) {
      const rows = (await request('POST', '/_bulk_docs', { docs })) as {
        id?: string
        rev?: string
        ok?: boolean
        error?: string
        reason?: string
      }[]
      // CouchDB reports per-document failures as { error: "conflict", reason }.
      return rows.map((row): DbWriteResult =>
        row.error
          ? {
              id: row.id,
              error: true,
              name: row.error,
              status: row.error === 'conflict' ? 409 : row.error === 'forbidden' ? 403 : 500,
              message: row.reason ?? row.error,
            }
          : { ok: true, id: row.id, rev: row.rev },
      )
    },
  }
}
