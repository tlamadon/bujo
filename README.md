# BuJo – Bullet Journal PWA

A local-first Bullet Journal app built with React, PouchDB, and CouchDB sync — plus a [`bujo` command line](#command-line-bujo) for the terminal and for AI agents.

| Path | What it is |
|---|---|
| `src/` | The PWA (React + `pouchdb-browser`, live sync to CouchDB) |
| `packages/core/` | `@bujo/core`: the domain logic, shared by the PWA and the CLI |
| `packages/cli/` | The `bujo` CLI |
| `middleware/` | Hono server: serves the PWA, proxies `/couchdb/*`, stamps `userId` on writes |
| `docs/AGENT.md` | How an AI agent should use the CLI |

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

- **bujo** – Hono server serving the frontend and proxying `/couchdb/` to CouchDB (with userId injection from Cloudflare auth headers, and optionally from [service tokens](#cli-access-through-cloudflare))
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

The CLI has no local copy: it reads and writes CouchDB directly, either on your LAN/tailnet or through the same Hono endpoint.

```
bujo CLI ──basic auth──────────────────────────────────────> CouchDB:5984
bujo CLI ──service token──> Cloudflare Access ──> Hono (/couchdb/*) ──> CouchDB:5984
```

## Command line (`bujo`)

A CLI for the same journal, built to be comfortable in a terminal and predictable for an agent: every command has `--json`, entries have short stable refs, and nothing ever prompts unless you are at a terminal.

```console
$ bujo add "Call plumber about the leak #house" --priority
added  we6zzh  *• Call plumber about the leak #house

$ bujo today
Sat 21 Nov 2026 · today · 2026-W47

  we6zzh  *• Call plumber about the leak #house

2 open tasks left on earlier days — run `bujo migrate`

$ bujo migrate
migrated  sewqdl   • Sort out the garage #house  (moved 4×)  from 2026-11-19
migrated  v6jd2c   • Draft Q4 report #work  (moved 1×)  from 2026-11-19

$ bujo done plumber
done  we6zzh  *× Call plumber about the leak #house
```

Signifiers: `•` task, `×` done, `>` migrated, `<` sent to the future log, `–` note, `○` event, `◇`/`◆` goal (open/achieved), `*` priority. Dropped entries are struck through (`~~like this~~` when colors are off). The six characters in front of each entry are its **ref**.

### Install

Node 20 or newer.

```bash
npm install          # once, in the repository root
npm run build:cli    # bundles packages/cli/dist/bujo.cjs

npx bujo today                 # run it from the repository
npm link --workspace bujo-cli  # or put `bujo` on your PATH
```

The bundle is a single self-contained file with no runtime dependencies: to use the CLI on another machine (say, the one your agent runs on), copy `packages/cli/dist/bujo.cjs` there and run it with `node`.

### Configure

Settings come from `~/.config/bujo/config.json` (or `$XDG_CONFIG_HOME/bujo/config.json`; `BUJO_CONFIG` points at another file), and environment variables override the file. `chmod 600` the file if it holds a password or secret.

| Config key | Environment variable | Meaning |
|---|---|---|
| `url` | `BUJO_URL` | The database URL (see the two modes below) |
| `user`, `password` | `BUJO_USER`, `BUJO_PASSWORD` | CouchDB basic auth |
| `cfClientId`, `cfClientSecret` | `BUJO_CF_CLIENT_ID`, `BUJO_CF_CLIENT_SECRET` | Cloudflare Access service token |
| `userId` | `BUJO_USER_ID` | Written to `userId` on documents the CLI writes |
| `timezone` | `BUJO_TZ` | IANA timezone that decides what "today" is. Default: the system timezone |

**Mode 1 — direct CouchDB** (LAN or tailnet). Nothing sits in front of CouchDB to stamp `userId`, so the CLI does it: set `userId` to the email you log in to the PWA with.

```json
{
  "url": "http://nas.local:5984/bujo",
  "user": "admin",
  "password": "your-couchdb-password",
  "userId": "you@example.com",
  "timezone": "America/Chicago"
}
```

**Mode 2 — through the public endpoint**, with a Cloudflare Access service token. The server stamps `userId` (see [CLI access through Cloudflare](#cli-access-through-cloudflare) for the server side).

```json
{
  "url": "https://bujo.example.com/couchdb/bujo",
  "cfClientId": "<client id>.access",
  "cfClientSecret": "<client secret>",
  "timezone": "America/Chicago"
}
```

Then check it:

```console
$ bujo doctor
ok    config    /home/you/.config/bujo/config.json
ok    timezone  America/Chicago — today is 2026-11-21
ok    url       https://bujo.example.com/couchdb/bujo (auth: cloudflare-access)
ok    read      database "bujo", 1284 documents
ok    write     the server accepts writes from these credentials
ok    userId    not set; the server stamps the user mapped to the service token
```

`bujo doctor` exits 1 if a check fails; the write check sends an empty batch, so it changes nothing. `bujo config` shows the effective settings and where each came from, without printing secrets.

### Commands

Run `bujo <command> --help` for the options of each. With no command, `bujo` shows today.

| | |
|---|---|
| **Look** | |
| `bujo today [--date D]` | Daily log: open tasks first (priority on top), then events by time, notes, done, dropped, and ghosts of entries that moved away |
| `bujo week [YYYY-Www\|+1\|-1]` | The week's goals, then each day Monday to Sunday |
| `bujo month [YYYY-MM\|+1\|-1]` | The month's goals, items with no day yet, a calendar summary, open tasks, events |
| `bujo future [--all]` | Unscheduled entries and everything after today, by month |
| `bujo tag <name> [--open]` | A collection: every entry with that `#tag` |
| `bujo tags` | All tags with open/total counts |
| `bujo search <text> [--open]` | Entries containing the text |
| `bujo show <ref>` | One entry in full, with its date history |
| `bujo stale [--min-moves 3]` | Open tasks moved N+ times — drop or do? |
| `bujo review week\|month [which]` | Read-only bundle for a review: counts, goals and their state, completed, still open, dropped, migrated out, stale |
| **Capture** | |
| `bujo add <text> [--date D] [--event] [--time HH:MM] [--note] [--priority]` | A task (default), event or note. `#tags` in the text become collections. `--time` implies `--event` |
| `bujo goal <text> [--week [W] \| --month [M]] [--priority]` | A goal for a week (default: this week) or a month |
| **Change** | |
| `bujo done <ref...>` | Mark done (a goal: achieved) |
| `bujo drop <ref...>` | No longer relevant; kept, struck through |
| `bujo undo <ref...>` | Reopen something done or dropped |
| `bujo move <ref> <date>` | Reschedule. Leaves a ghost on the old day and appends to `dateHistory` |
| `bujo schedule <ref> <YYYY-MM\|unscheduled>` | Send to the future log |
| `bujo edit <ref> <text>` | Replace the text (tags are re-read) |
| `bujo prio <ref...> [--off]` | Set or clear the priority mark |
| `bujo rm <ref...>` | Delete for good, with its ghosts |
| `bujo migrate [--dry-run]` | Move open tasks from earlier days to today, like the button in the app |
| **Setup** | |
| `bujo config`, `bujo doctor` | Show the configuration; check connection, auth and write access |

Options accepted by every command, before or after it: `--json`, `--no-color`, `-y/--yes`, `--tz <zone>`.

**Referring to entries.** Anywhere a `<ref>` is expected you can give:

- the **short ref** (`we6zzh`) — stable for the life of the entry, including across moves;
- the **full id** (`2026-11-21:1795281285938:sewqdl`) — an id from before a move still works;
- any **part of the text** (`plumber`), at least 3 characters, if it identifies one entry. Text is matched against open entries first (closed ones for `undo`) and only then against the rest; `rm` never narrows like that.

If a text matches several entries the command changes nothing, lists the candidates and exits 2:

```console
$ bujo done call; echo "exit code $?"
error: "call" matches 2 entries; use a ref
  9h389n  2026-11-21    • Call mum
  71p1wk  2026-11-21    • Call the bank
exit code 2
```

**Dates.** `--date`, `move` and `schedule` accept:

| Input | Meaning |
|---|---|
| `2026-12-24` | That day |
| `today`, `tomorrow`, `yesterday` | |
| `mon` … `sun` (or full names) | The next such weekday, never today |
| `+3d`, `-1d`, `+2w`, `+3` | Days (default) or weeks from today |
| `next-week` | Monday of next week |
| `2027-02`, `this-month`, `next-month` | A month: the future log, "some time in February" |
| `unscheduled` (`someday`, `none`) | No date |

Goals take a week (`2026-W48`, `this`, `next`, `+1`) or a month (`2026-12`, `next`, `+1`). Weeks are ISO weeks and start on Monday.

**Exit codes.** `0` success · `1` error (bad input, configuration, connection, a refused confirmation) · `2` a reference matched no entry, or more than one. Results go to stdout, errors to stderr.

**Prompts.** Only `rm`, and `drop` with more than one entry, ask for confirmation, and only when stdin is a terminal and `--yes` was not given. Without a terminal they refuse (exit 1) unless you pass `--yes`.

**Colors** are used when stdout is a terminal. `--no-color` or `NO_COLOR=1` turns them off; `FORCE_COLOR=1` turns them on.

### `--json`

Every command accepts `--json` and then prints exactly one JSON object on stdout. The schema is stable: fields may be added, existing ones will not change meaning.

```jsonc
{
  "ok": true,
  "command": "show",
  "today": "2026-11-21",   // "today" in the configured timezone
  // … fields of the command, see below
}
```

Errors are printed on stderr, also as JSON, with the exit codes above:

```json
{
  "ok": false,
  "error": {
    "code": "ambiguous",
    "message": "\"call\" matches 2 entries; use a ref",
    "candidates": [ { "ref": "9h389n", "body": "Call mum", "…": "…" } ]
  }
}
```

`error.code` is one of `not_found`, `ambiguous` (with `candidates`, each an entry), `invalid`, `usage`, `config`, `auth`, `connection`, `error`.

**An entry** always has every one of these fields:

```json
{
  "ref": "sewqdl",
  "id": "2026-11-21:1795281285938:sewqdl",
  "status": "task",
  "date": "2026-11-21",
  "dateKind": "day",
  "body": "Sort out the garage #house",
  "text": "Sort out the garage",
  "tags": ["house"],
  "priority": false,
  "open": true,
  "time": null,
  "goalState": null,
  "dateHistory": ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"],
  "moves": 4,
  "createdAt": "2026-11-21T17:14:45.938Z"
}
```

| Field | |
|---|---|
| `ref` | Short stable reference. Use this to target the entry later |
| `id` | Full document id. Its date prefix changes when the entry moves; the rest never does |
| `status` | `task` · `completed` · `dropped` · `note` · `event` · `goal` (and `migrated` / `scheduled`, which only old entries carry) |
| `date`, `dateKind` | `YYYY-MM-DD` (`day`), `YYYY-MM` (`month`), `YYYY-Www` (`week`) or `"unscheduled"` (`unscheduled`) |
| `body`, `text`, `tags` | Text as written; text without `#tags`; the tags, lowercase |
| `priority` | The `*` signifier |
| `open` | Still to do: an open task or an open goal |
| `time` | `HH:MM` for a timed event, else `null` |
| `goalState` | `open` · `achieved` · `dropped` for goals, `null` for everything else |
| `dateHistory`, `moves` | Dates the entry was on before, oldest first, and how many (`moves == dateHistory.length`) |
| `createdAt` | ISO 8601 timestamp |

A **ghost** — an entry seen on a day it was moved away from — is an entry plus `ghostDate` (that day); its `date` says where it is now.

**Fields per command** (besides `ok`, `command`, `today`):

| Command | Fields |
|---|---|
| `today` | `date`, `weekday`, `isToday`, `week`, `entries[]`, `ghosts[]`, `overdue[]` (open tasks left on earlier days; only filled for today) |
| `week` | `week`, `start`, `end`, `current`, `goals[]`, `days[]` of `{ date, weekday, isToday, entries[], ghosts[] }` |
| `month` | `month`, `start`, `end`, `current`, `goals[]`, `undated[]`, `open[]`, `events[]`, `days[]` of `{ date, weekday, isToday, counts: { total, open, completed, dropped, events, notes, ghosts } }` |
| `future` | `unscheduled[]`, `months[]` of `{ month, entries[] }` |
| `tag` | `tag`, `name`, `color`, `open`, `total`, `entries[]` |
| `tags` | `tags[]` of `{ name, color, open, total }` |
| `search` | `query`, `entries[]` |
| `show` | `entry`, `ghostDates[]` |
| `stale` | `minMoves`, `entries[]` |
| `review` | `kind`, `period`, `start`, `end`, `current`, `counts: { completed, open, dropped, migrated, events, notes, goals: { open, achieved, dropped } }`, `goals[]`, `monthGoals[]` of `{ month, goals[] }` (weekly reviews), `completed[]`, `open[]`, `dropped[]`, `migrated[]` (ghosts), `stale[]`, `staleMinMoves` |
| `add`, `goal` | `entry` |
| `done`, `drop`, `undo`, `edit`, `prio` | `entries[]`, after the change |
| `move`, `schedule` | `from`, `entry` |
| `rm` | `deleted[]` |
| `migrate` | `dryRun`, `count`, `entries[]` (after the move; with `--dry-run`, as they are now) |
| `config` | `path`, `fileFound`, `url`, `auth[]`, `user`, `cfClientId`, `hasPassword`, `hasCfClientSecret`, `userId`, `timezone`, `sources`, `env` |
| `doctor` | `checks[]` of `{ name, status: ok \| warn \| fail, detail }`; `ok` is false and the exit code 1 if any check fails |

In a review, counts go by where entries are dated: a task counts as completed in the week it was completed *on*. `migrated` are entries that were on a day of the period and now live outside it.

```console
$ bujo review week --json | jq '.counts'
{
  "completed": 2,
  "open": 2,
  "dropped": 1,
  "migrated": 0,
  "events": 0,
  "notes": 1,
  "goals": {
    "open": 1,
    "achieved": 0,
    "dropped": 0
  }
}
```

### CLI access through Cloudflare

Writes through the public endpoint need a `userId`, which the server takes from the email Cloudflare Access attaches after a browser login. A service token has no email, so the server has to be told which user each token writes as. It then verifies the signed JWT Cloudflare forwards with every request (`Cf-Access-Jwt-Assertion`) and looks the token up in that list.

1. In the Cloudflare Zero Trust dashboard, create a **service token** and note its Client ID and Client Secret.
2. On the Access application that protects the app, add a policy with the action **Service Auth** that includes that token. (With any other action, Access asks for a browser login.)
3. Copy the application's **AUD tag** from its settings.
4. Add to the server's `.env`, then `docker compose up -d`:

   ```
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<the application's AUD tag>
   BUJO_SERVICE_TOKENS=<client id>.access=you@example.com
   ```

   `BUJO_SERVICE_TOKENS` is a comma-separated list of `clientId=userId`. Use the email you log in with as the `userId`, so the CLI's entries are yours.
5. Put the Client ID and Secret in the CLI's config and run `bujo doctor`.

This is off unless all three variables are set, and browser logins work exactly as before either way. A token that is valid at Cloudflare but not in the list can read but not write: `bujo doctor` reports that as a failed write check.

### Data model

Everything is a CouchDB document; the new fields are optional, so older documents and older app versions keep working.

**Entries** — `{ type: "entry", date, status, body, tags, dateHistory, createdAt, userId }`, plus when used: `priority: true`, `time: "HH:MM"` (events), `goalState: "achieved" | "dropped"` (goals), `prevStatus` (what a note or event was before it was completed or dropped, so `undo` restores it).

**Ids and refs.** `_id` is `<date>:<createdAt ms>:<uid>`. The date prefix makes "everything on this day" a key-range query. Rescheduling replaces only that prefix — CouchDB cannot rename a document, so the entry is rewritten under the new id and the old one deleted — and the `<createdAt ms>:<uid>` tail never changes. The 6-character `uid` is the short ref. Existing entries already have this shape, so they got stable refs without a migration. Two entries could in principle share a `uid`; the CLI then reports the ref as ambiguous and the full id still works.

**Dates and period keys.** An entry's `date` is one of:

| Kind | Format | Used for |
|---|---|---|
| day | `2026-11-21` | The daily log |
| month | `2026-11` | The future log ("some time in November"), and monthly goals |
| week | `2026-W47` | Weekly goals. ISO 8601 week, Monday start |
| unscheduled | `~unscheduled` | No date yet |

Goals are entries with `status: "goal"` whose `date` is a week or month key, so their id starts with it: one prefix query (`2026-W47:` … or `2026-11:` …) returns the goals of a period. In key order a month sorts right after its own days and before the next month, and a year's weeks sort after its months, before the next year. Day-range queries return day-dated entries only, so goals and future-log items never show up in a daily or weekly list by accident.

**Ghosts** — `{ type: "ghost", date, ref }` with id `ghost:<day>:<entry tail>`: one per day an entry was moved away from, pointing at where it is now. A ghost is removed when its entry comes back to that day.

**Migration** moves open tasks from days before today to today. A task dated to a month moves only once that month is over. Goals are never migrated: an unmet goal stays in its period for the review.

## Development

```bash
npm test          # core, CLI and middleware tests (vitest)
npm run lint
npm run build     # typechecks everything, builds the PWA
npm run build:cli # bundles the CLI
```

The tests need no services: core runs on PouchDB's memory adapter, and the CLI's HTTP client talks to a small fake CouchDB. To also run the HTTP tests against a real CouchDB (each run creates and deletes its own `bujo_test_*` database):

```bash
docker compose -f docker-compose.dev.yml up -d
BUJO_TEST_COUCH_URL=http://admin:changeme@localhost:5984 npm test
```

`BUJO_NOW=2026-11-21T18:00:00Z` pins the CLI's clock, which is handy for reproducible runs.
