import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

const COUCHDB_USER = process.env.COUCHDB_USER ?? 'admin'
const COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD ?? 'changeme'
const COUCHDB_URL = `http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@couchdb:5984`

function getUserId(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('cf-access-authenticated-user-email') ?? null
}

function injectUserId<T extends Record<string, unknown>>(doc: T, userId: string): T {
  // Skip internal PouchDB replication checkpoint docs
  if (typeof doc._id === 'string' && doc._id.startsWith('_local/')) return doc
  return { ...doc, userId }
}

// POST /bujo/_bulk_docs — the main write path for PouchDB replication
app.post('/bujo/_bulk_docs', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json()
  if (Array.isArray(body.docs)) {
    body.docs = body.docs.map((doc: Record<string, unknown>) => injectUserId(doc, userId))
  }

  const resp = await fetch(`${COUCHDB_URL}/bujo/_bulk_docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

// PUT /bujo/{docid} — individual doc writes
app.put('/bujo/:docid', async (c) => {
  const docid = c.req.param('docid')

  // _local/ docs are PouchDB replication checkpoints — pass through
  if (docid.startsWith('_local/')) {
    const resp = await fetch(`${COUCHDB_URL}/bujo/${encodeURIComponent(docid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: await c.req.text(),
    })
    return new Response(resp.body, { status: resp.status, headers: resp.headers })
  }

  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json()
  const modified = injectUserId(body, userId)

  const resp = await fetch(`${COUCHDB_URL}/bujo/${encodeURIComponent(docid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(modified),
  })
  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

// All other requests — proxy through unchanged
app.all('/bujo/*', async (c) => {
  const path = c.req.path
  const url = `${COUCHDB_URL}${path}${new URL(c.req.url).search}`

  const headers: Record<string, string> = { 'Content-Type': c.req.header('content-type') ?? 'application/json' }

  const resp = await fetch(url, {
    method: c.req.method,
    headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.text(),
  })
  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

const port = Number(process.env.PORT ?? 3000)
console.log(`Middleware listening on port ${port}`)
serve({ fetch: app.fetch, port })
