# BuJo – Bullet Journal PWA

A local-first Bullet Journal app built with React, PouchDB, and CouchDB sync.

## Local Development

```bash
npm install
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

This starts a local CouchDB instance and a Vite dev server at `http://localhost:5173`. The Vite proxy forwards `/couchdb/` requests to CouchDB so sync works out of the box.

To stop CouchDB when you're done:

```bash
docker compose -f docker-compose.dev.yml down
```

## Deploying with Docker Compose

### 1. Create a `.env` file

Copy the example and set your own credentials:

```bash
cp .env.example .env
```

Edit `.env` and set a strong CouchDB password:

```
COUCHDB_USER=admin
COUCHDB_PASSWORD=your-secure-password-here
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here
```

### 2. Start the stack

```bash
docker compose up -d
```

This starts three services:

- **bujo** – Hono server serving the frontend and proxying `/couchdb/` to CouchDB (with userId injection from Cloudflare auth headers)
- **couchdb** – CouchDB 3 instance with persistent storage
- **couchdb-init** – One-shot container that waits for CouchDB to be ready and creates the `bujo` database
- **cloudflared** – (Optional) Cloudflare Tunnel for exposing the app externally

### 3. Access the app

The `bujo` service listens on port 3000 inside Docker. To expose it on your host, add a port mapping in `docker-compose.yml`:

```yaml
services:
  bujo:
    ports:
      - "8080:3000"
```

Then visit `http://localhost:8080`.

Alternatively, if you have a Cloudflare Tunnel token configured in `.env`, the app is accessible through your tunnel domain.

### CouchDB credentials

The CouchDB username and password are set via environment variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `COUCHDB_USER` | `admin` | CouchDB admin username |
| `COUCHDB_PASSWORD` | `changeme` | CouchDB admin password |

These are used by both the CouchDB container and the init script that creates the `bujo` database. **Change the default password before deploying.**

CouchDB data is persisted in a Docker volume (`couchdb_data`), so it survives container restarts.

### Architecture

```
Browser (PouchDB) <──sync──> Hono (/couchdb/*) <──proxy──> CouchDB:5984
                              │
                              └── Static files (Vite build)
```

The frontend uses PouchDB to store data locally in IndexedDB. When CouchDB is available, PouchDB syncs bidirectionally in real-time, enabling cross-device access.
