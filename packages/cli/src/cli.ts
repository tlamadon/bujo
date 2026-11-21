import { Command, CommanderError, Option } from 'commander'
import {
  AmbiguousError,
  BujoError,
  InvalidError,
  createBujo,
  dateKind,
  dayLog,
  displayDate,
  entryDetail,
  futureLog,
  isClosed,
  isDayDate,
  isOpen,
  isoWeekKey,
  monthLog,
  parseDateInput,
  parseMonthInput,
  parseWeekInput,
  reviewPeriod,
  searchEntries,
  tagCollection,
  tagList,
  toEntryView,
  todayIn,
  weekLog,
  type Bujo,
  type BujoDb,
  type BujoEntry,
  type EntryView,
} from '@bujo/core'
import {
  ConfigError,
  SECRET_KEYS,
  authHeaders,
  authModes,
  envVarFor,
  loadConfig,
  type ConfigKey,
  type LoadedConfig,
} from './config'
import {
  entryLine,
  renderChanges,
  renderChecks,
  renderDay,
  renderDetail,
  renderFuture,
  renderList,
  renderMonth,
  renderReview,
  renderTable,
  renderTag,
  renderTags,
  renderWeek,
  type Check,
  type Fmt,
} from './format'
import { AuthError, ConnectionError, createHttpDb, type HttpDb } from './http-db'

declare const __BUJO_CLI_VERSION__: string | undefined
const VERSION = typeof __BUJO_CLI_VERSION__ === 'string' ? __BUJO_CLI_VERSION__ : 'dev'

export const EXIT_OK = 0
export const EXIT_ERROR = 1
/** No entry matched a reference, or more than one did */
export const EXIT_NO_MATCH = 2

/** Everything the CLI touches outside its own code, so tests can replace it. */
export interface CliIo {
  stdout(text: string): void
  stderr(text: string): void
  env: NodeJS.ProcessEnv
  /** stdin is a terminal, so asking a question is possible */
  stdinIsTTY: boolean
  /** stdout is a terminal, so colors are on unless turned off */
  stdoutIsTTY: boolean
  /** Ask a yes/no question on the terminal */
  confirm(question: string): Promise<boolean>
  /** Clock override (tests) */
  now?: () => number
  /** Database override (tests); otherwise built from the configuration */
  db?: BujoDb
}

/** What a command produces: data for `--json`, and how to show it to a person. */
interface Output {
  data: Record<string, unknown>
  text: (f: Fmt) => string
  /** Exit code when it is not 0 (e.g. `doctor` with failing checks) */
  exitCode?: number
}

interface Flags {
  json: boolean
  color: boolean
  yes: boolean
  tz?: string
  config?: string
}

interface Session {
  bujo: Bujo
  db: BujoDb
  today: string
  loaded: LoadedConfig
  timezone?: string
}

class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

// Commander reads `-1` and `-1d` as options. Relative dates are far more
// useful than digit flags here, so such arguments are disguised on the way
// in and restored when a command reads them.
const NEGATIVE = /^-(\d+[dw]?)$/
const NEGATIVE_MARK = '−'

function protectNegatives(argv: string[]): string[] {
  return argv.map((arg) => arg.replace(NEGATIVE, `${NEGATIVE_MARK}$1`))
}

function restoreNegative(value: string): string {
  return value.startsWith(NEGATIVE_MARK) ? `-${value.slice(NEGATIVE_MARK.length)}` : value
}

const PREFER_OPEN = { prefer: isOpen }
const PREFER_CLOSED = { prefer: isClosed }

function unique(entries: BujoEntry[]): BujoEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => (seen.has(e._id) ? false : (seen.add(e._id), true)))
}

function positiveInt(name: string) {
  return (value: string): number => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`${name} must be a positive whole number (got "${value}")`)
    return n
  }
}

/**
 * Run the CLI. Returns the process exit code:
 * 0 ok · 1 error · 2 a reference matched no entry, or several.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const args = protectNegatives(argv)
  // Needed before parsing, to report parse errors in the right format
  const wantsJson = args.includes('--json')
  let exitCode = EXIT_OK

  const program = new Command('bujo')
  program
    .description('Bullet Journal from the terminal — for you and for your agent.\nWith no command, shows today.')
    .version(VERSION, '-V, --version')
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: () => {}, outputError: () => {} })
    .showSuggestionAfterError(true)
    .addHelpText(
      'after',
      `
Entries are referred to by their short ref (the 6 characters shown before
each entry), their full id, or any unique part of their text.

Dates: YYYY-MM-DD, today, tomorrow, mon..sun, +3d, +2w, next-week,
YYYY-MM or next-month (future log), unscheduled.

Exit codes: 0 ok, 1 error, 2 no entry (or more than one) matched a reference.
Configuration: ~/.config/bujo/config.json or BUJO_URL, BUJO_USER, … — see \`bujo config\`.`,
    )

  /** Options every command accepts, so they work before or after the command name. */
  function common(cmd: Command): Command {
    return cmd
      .option('--json', 'machine-readable output (stable schema, see README)')
      .option('--no-color', 'plain text, no ANSI colors')
      .option('-y, --yes', 'do not ask for confirmation')
      .option('--tz <zone>', 'timezone that decides what "today" is (IANA name)')
      .addOption(new Option('--config <path>', 'config file to use').hideHelp())
  }
  common(program)

  function flagsOf(cmd: Command): Flags {
    const local = cmd.opts()
    const global = program.opts()
    return {
      json: !!(local.json || global.json),
      color: local.color !== false && global.color !== false,
      yes: !!(local.yes || global.yes),
      tz: local.tz ?? global.tz,
      config: local.config ?? global.config,
    }
  }

  function useColor(flags: Flags): boolean {
    if (flags.json || !flags.color || io.env.NO_COLOR) return false
    return io.env.FORCE_COLOR ? io.env.FORCE_COLOR !== '0' : io.stdoutIsTTY
  }

  function clock(): () => number {
    if (io.now) return io.now
    // BUJO_NOW pins the clock, for reproducible runs and tests
    const pinned = io.env.BUJO_NOW ? Date.parse(io.env.BUJO_NOW) : NaN
    if (Number.isNaN(pinned)) return Date.now
    const started = Date.now()
    return () => pinned + (Date.now() - started)
  }

  function connect(loaded: LoadedConfig): HttpDb {
    const { config } = loaded
    if (!config.url) {
      throw new ConfigError(
        `No database URL configured. Set BUJO_URL or create ${loaded.path} — see \`bujo config\``,
      )
    }
    return createHttpDb({ url: config.url, headers: authHeaders(config) })
  }

  function open(flags: Flags): Session {
    const loaded = loadConfig(io.env, flags.config)
    const timezone = flags.tz ?? loaded.config.timezone
    const now = clock()
    const today = todayIn(timezone, now())
    const db = io.db ?? connect(loaded)
    return { bujo: createBujo(db, { userId: loaded.config.userId, now }), db, today, loaded, timezone }
  }

  /** Destructive commands: go ahead with --yes, ask on a terminal, refuse otherwise. */
  async function confirmOrRefuse(flags: Flags, question: string, refusal: string): Promise<void> {
    if (flags.yes) return
    if (!io.stdinIsTTY) throw new UsageError(`${refusal} without --yes (not on a terminal, cannot ask)`)
    if (!(await io.confirm(question))) throw new UsageError('Cancelled')
  }

  /** Define a command: shared options, output in the requested format, exit code. */
  function define(
    spec: string,
    description: string,
    configure: (cmd: Command) => void,
    handler: (flags: Flags, args: string[], opts: Record<string, unknown>) => Promise<Output>,
  ): Command {
    const cmd = common(program.command(spec).description(description))
    configure(cmd)
    const name = spec.split(' ')[0]
    cmd.action(async (...actionArgs: unknown[]) => {
      const command = actionArgs[actionArgs.length - 1] as Command
      const opts = command.opts() as Record<string, unknown>
      for (const [key, value] of Object.entries(opts)) {
        if (typeof value === 'string') opts[key] = restoreNegative(value)
      }
      // Positional arguments, with variadic ones flattened in place
      const positional = actionArgs.slice(0, -2).flat().filter((a): a is string => typeof a === 'string').map(restoreNegative)
      const flags = flagsOf(command)
      const output = await handler(flags, positional, opts)
      if (flags.json) {
        io.stdout(`${JSON.stringify({ ok: output.exitCode === undefined, command: name, ...output.data }, null, 2)}\n`)
      } else {
        const f: Fmt = { color: useColor(flags), today: typeof output.data.today === 'string' ? output.data.today : todayIn(flags.tz) }
        io.stdout(`${output.text(f)}\n`)
      }
      if (output.exitCode !== undefined) exitCode = output.exitCode
    })
    return cmd
  }

  const changed = (
    s: Session,
    verb: string,
    entries: BujoEntry[],
    note?: (e: BujoEntry) => string | undefined,
  ): Output => {
    const views = entries.map(toEntryView)
    return {
      data: { today: s.today, entries: views },
      text: (f) => renderChanges(views.map((entry, i) => ({ verb, entry, note: note?.(entries[i]) })), f),
    }
  }

  // ─── Views ───────────────────────────────────────────────────────

  define(
    'today',
    'daily log: entries and ghosts, open tasks first',
    (cmd) => cmd.option('-d, --date <date>', 'show another day (YYYY-MM-DD, tomorrow, mon, -1d, …)'),
    async (flags, _args, opts) => {
      const s = open(flags)
      const date = opts.date ? parseDateInput(String(opts.date), s.today) : s.today
      if (!isDayDate(date)) throw new InvalidError(`"${opts.date}" is not a single day — try \`bujo month\` or \`bujo future\``)
      const view = await dayLog(s.bujo, date, s.today)
      return { data: { today: s.today, ...view }, text: (f) => renderDay(view, f) }
    },
  )

  define(
    'week [week]',
    'weekly log: goals, then each day (YYYY-Www, +1, -1, next, last; default: this week)',
    () => {},
    async (flags, [week]) => {
      const s = open(flags)
      const view = await weekLog(s.bujo, parseWeekInput(week, s.today), s.today)
      return { data: { today: s.today, ...view }, text: (f) => renderWeek(view, f) }
    },
  )

  define(
    'month [month]',
    'monthly log: goals, calendar summary, open tasks (YYYY-MM, +1, -1; default: this month)',
    () => {},
    async (flags, [month]) => {
      const s = open(flags)
      const view = await monthLog(s.bujo, parseMonthInput(month, s.today), s.today)
      return { data: { today: s.today, ...view }, text: (f) => renderMonth(view, f) }
    },
  )

  define(
    'future',
    'future log: unscheduled entries and everything dated after today, by month',
    (cmd) => cmd.option('-a, --all', 'include completed and dropped entries'),
    async (flags, _args, opts) => {
      const s = open(flags)
      const view = await futureLog(s.bujo, s.today, { includeClosed: !!opts.all })
      return { data: { ...view }, text: (f) => renderFuture(view, f) }
    },
  )

  define(
    'tag <name>',
    'a collection: every entry carrying a #tag',
    (cmd) => cmd.option('-o, --open', 'only open tasks and goals'),
    async (flags, [name], opts) => {
      const s = open(flags)
      const view = await tagCollection(s.bujo, name, { openOnly: !!opts.open })
      return { data: { today: s.today, tag: view.name, ...view }, text: (f) => renderTag(view, f) }
    },
  )

  define('tags', 'list tags with open/total counts', () => {}, async (flags) => {
    const s = open(flags)
    const { tags } = await tagList(s.bujo)
    return { data: { tags }, text: (f) => renderTags(tags, f) }
  })

  define(
    'search <text...>',
    'find entries by text',
    (cmd) => cmd.option('-o, --open', 'only open tasks and goals'),
    async (flags, words, opts) => {
      const s = open(flags)
      const query = words.join(' ')
      const entries = await searchEntries(s.bujo, query, { openOnly: !!opts.open })
      return {
        data: { today: s.today, query, entries },
        text: (f) => renderList(`Search "${query}"`, entries, f, 'nothing found'),
      }
    },
  )

  define('show <ref>', 'full detail of one entry, including its date history', () => {}, async (flags, [ref]) => {
    const s = open(flags)
    const detail = await entryDetail(s.bujo, await s.bujo.findEntry(ref))
    return { data: { today: s.today, ...detail }, text: (f) => renderDetail(detail, f) }
  })

  define(
    'stale',
    'open tasks that keep getting moved — drop or do?',
    (cmd) => cmd.option('-n, --min-moves <n>', 'how many moves make a task stale', positiveInt('--min-moves'), 3),
    async (flags, _args, opts) => {
      const s = open(flags)
      const minMoves = opts.minMoves as number
      const entries = (await s.bujo.getStaleTasks(minMoves)).map(toEntryView)
      return {
        data: { today: s.today, minMoves, entries },
        text: (f) => renderList(`Stale tasks (moved ${minMoves}+ times)`, entries, f, 'nothing stale'),
      }
    },
  )

  define(
    'review <period> [which]',
    'data for a review of a week or month: counts, goals, done, open, dropped, migrated, stale (read-only)',
    (cmd) =>
      cmd
        .option('-n, --min-moves <n>', 'how many moves make a task stale', positiveInt('--min-moves'), 3)
        .option('--dry-run', 'accepted for symmetry with migrate; review never changes anything')
        .addHelpText('after', '\n<period> is `week` or `month`; [which] picks one (YYYY-Www / YYYY-MM, -1, last; default: current).'),
    async (flags, [kind, which], opts) => {
      const s = open(flags)
      let period: string
      if (kind === 'week') period = parseWeekInput(which, s.today)
      else if (kind === 'month') period = parseMonthInput(which, s.today)
      else throw new UsageError(`review what? Use \`bujo review week\` or \`bujo review month\` (got "${kind}")`)
      const view = await reviewPeriod(s.bujo, period, s.today, { minMoves: opts.minMoves as number })
      return { data: { today: s.today, ...view }, text: (f) => renderReview(view, f) }
    },
  )

  // ─── Capture ─────────────────────────────────────────────────────

  define(
    'add <text...>',
    'add a task (or --event / --note); #tags in the text become collections',
    (cmd) =>
      cmd
        .option('-d, --date <date>', 'when: YYYY-MM-DD, today, tomorrow, mon, +3d, next-week, YYYY-MM, unscheduled', 'today')
        .option('-e, --event', 'an event instead of a task')
        .option('-t, --time <HH:MM>', 'time of the event (implies --event)')
        .option('-n, --note', 'a note instead of a task')
        .option('-p, --priority', 'mark as priority (*)'),
    async (flags, words, opts) => {
      if (opts.note && (opts.event || opts.time)) throw new UsageError('An entry is either a note or an event, not both')
      const s = open(flags)
      const date = parseDateInput(String(opts.date), s.today)
      if (dateKind(date) === 'week') throw new InvalidError('Only goals are dated by week — use `bujo goal "…" --week`')
      const status = opts.note ? 'note' : opts.event || opts.time ? 'event' : 'task'
      const entry = await s.bujo.addEntry(date, status, words.join(' '), {
        priority: !!opts.priority,
        ...(opts.time ? { time: String(opts.time) } : {}),
      })
      const view = toEntryView(entry)
      return {
        data: { today: s.today, entry: view },
        text: (f) => renderChanges([{ verb: 'added', entry: view, note: view.date === s.today ? undefined : `on ${view.date}` }], f),
      }
    },
  )

  define(
    'goal <text...>',
    'add a goal for a week (default: this week) or a month',
    (cmd) =>
      cmd
        .option('-w, --week [week]', 'YYYY-Www, next, +1 (default: this week)')
        .option('-m, --month [month]', 'YYYY-MM, next, +1 (default: this month)')
        .option('-p, --priority', 'mark as priority (*)'),
    async (flags, words, opts) => {
      if (opts.week !== undefined && opts.month !== undefined) throw new UsageError('A goal is for a week or a month, not both')
      const s = open(flags)
      const arg = (value: unknown) => (typeof value === 'string' ? value : undefined)
      const period =
        opts.month !== undefined ? parseMonthInput(arg(opts.month), s.today) : parseWeekInput(arg(opts.week), s.today)
      const view = toEntryView(await s.bujo.addGoal(period, words.join(' '), { priority: !!opts.priority }))
      return {
        data: { today: s.today, entry: view },
        text: (f) => renderChanges([{ verb: 'added', entry: view, note: `goal for ${period}` }], f),
      }
    },
  )

  // ─── Changing entries ────────────────────────────────────────────

  define('done <ref...>', 'mark entries done (a goal: achieved)', () => {}, async (flags, refs) => {
    const s = open(flags)
    const entries = unique(await s.bujo.findEntries(refs, PREFER_OPEN))
    const results: BujoEntry[] = []
    for (const entry of entries) results.push(await s.bujo.completeEntry(entry))
    return changed(s, 'done', results)
  })

  define(
    'drop <ref...>',
    'drop entries: no longer relevant (shown struck through)',
    () => {},
    async (flags, refs) => {
      const s = open(flags)
      const entries = unique(await s.bujo.findEntries(refs, PREFER_OPEN))
      if (entries.length > 1) {
        await confirmOrRefuse(flags, `Drop ${entries.length} entries?`, `Refusing to drop ${entries.length} entries`)
      }
      const results: BujoEntry[] = []
      for (const entry of entries) results.push(await s.bujo.dropEntry(entry))
      return changed(s, 'dropped', results)
    },
  )

  define('undo <ref...>', 'reopen entries that were done or dropped', () => {}, async (flags, refs) => {
    const s = open(flags)
    const entries = unique(await s.bujo.findEntries(refs, PREFER_CLOSED))
    const results: BujoEntry[] = []
    for (const entry of entries) results.push(await s.bujo.reopenEntry(entry))
    return changed(s, 'reopened', results, (e) => (isClosed(e) ? undefined : `now ${e.status === 'goal' ? 'an open goal' : `a ${e.status}`}`))
  })

  /** Where a goal can go: a week or month. A day means "the week of that day". */
  function goalPeriod(input: string, today: string): string {
    const date = parseDateInput(input, today)
    if (isDayDate(date)) return isoWeekKey(date)
    if (dateKind(date) === 'unscheduled') throw new InvalidError('A goal belongs to a week or a month; it cannot be unscheduled')
    return date
  }

  async function move(s: Session, ref: string, target: (entry: BujoEntry) => string): Promise<Output> {
    const entry = await s.bujo.findEntry(ref, PREFER_OPEN)
    const from = displayDate(entry.date)
    const moved = await s.bujo.rescheduleEntry(entry, target(entry))
    const view = toEntryView(moved)
    return {
      data: { today: s.today, from, entry: view },
      text: (f) =>
        renderChanges([{ verb: from === view.date ? 'unchanged' : 'moved', entry: view, note: `${from} → ${view.date}` }], f),
    }
  }

  define(
    'move <ref> <date>',
    'reschedule an entry (leaves a ghost on the old day, records the move)',
    () => {},
    async (flags, [ref, date]) => {
      const s = open(flags)
      return move(s, ref, (entry) =>
        entry.status === 'goal' ? goalPeriod(date, s.today) : parseDateInput(date, s.today),
      )
    },
  )

  define(
    'schedule <ref> <when>',
    'send an entry to the future log: a month (YYYY-MM, next-month) or unscheduled',
    () => {},
    async (flags, [ref, when]) => {
      const s = open(flags)
      return move(s, ref, (entry) => {
        if (entry.status === 'goal') return goalPeriod(when, s.today)
        const date = parseDateInput(when, s.today)
        const kind = dateKind(date)
        if (kind !== 'month' && kind !== 'unscheduled') {
          throw new InvalidError(
            `schedule takes a month (YYYY-MM, next-month) or \`unscheduled\`; for a specific day use \`bujo move ${ref} ${when}\``,
          )
        }
        return date
      })
    },
  )

  define('edit <ref> <text...>', 'replace the text of an entry (#tags are re-read)', () => {}, async (flags, [ref, ...words]) => {
    const s = open(flags)
    const entry = await s.bujo.findEntry(ref, PREFER_OPEN)
    return changed(s, 'edited', [await s.bujo.updateEntry(entry, { body: words.join(' ') })])
  })

  define(
    'prio <ref...>',
    'mark entries as priority (*)',
    (cmd) => cmd.option('--off', 'remove the priority mark'),
    async (flags, refs, opts) => {
      const s = open(flags)
      const entries = unique(await s.bujo.findEntries(refs, PREFER_OPEN))
      const results: BujoEntry[] = []
      for (const entry of entries) results.push(await s.bujo.updateEntry(entry, { priority: !opts.off }))
      return changed(s, opts.off ? 'unmarked' : 'priority', results)
    },
  )

  define('rm <ref...>', 'delete entries for good (and their ghosts)', () => {}, async (flags, refs) => {
    const s = open(flags)
    // Deleting is not the place for guessing: no preference between matches
    const entries = unique(await s.bujo.findEntries(refs))
    const views = entries.map(toEntryView)
    const listing = views.map((v) => entryLine(v, { color: false, today: s.today })).join('\n')
    await confirmOrRefuse(
      flags,
      `${listing}\nDelete ${entries.length === 1 ? 'this entry' : `these ${entries.length} entries`}?`,
      `Refusing to delete ${entries.length === 1 ? 'an entry' : `${entries.length} entries`}`,
    )
    for (const entry of entries) await s.bujo.deleteEntry(entry)
    return {
      data: { today: s.today, deleted: views },
      text: (f) => renderChanges(views.map((entry) => ({ verb: 'deleted', entry })), f),
    }
  })

  // ─── Migration ───────────────────────────────────────────────────

  define(
    'migrate',
    'move open tasks left on earlier days to today (like the app)',
    (cmd) => cmd.option('--dry-run', 'only list what would move'),
    async (flags, _args, opts) => {
      const s = open(flags)
      const dryRun = !!opts.dryRun
      const entries = dryRun ? await s.bujo.getOverdueTasks(s.today) : await s.bujo.migrateOpenTasks(s.today)
      const views = entries.map(toEntryView)
      return {
        data: { today: s.today, dryRun, count: views.length, entries: views },
        text: (f) =>
          views.length === 0
            ? 'Nothing to migrate.'
            : renderChanges(
                views.map((entry) => ({
                  verb: dryRun ? 'would move' : 'migrated',
                  entry,
                  note: dryRun ? `${entry.date} → ${s.today}` : `from ${entry.dateHistory[entry.dateHistory.length - 1]}`,
                })),
                f,
              ),
      }
    },
  )

  // ─── Setup ───────────────────────────────────────────────────────

  define('config', 'show the effective configuration and where each value comes from', () => {}, async (flags) => {
    const loaded = loadConfig(io.env, flags.config)
    const { config, sources } = loaded
    const timezone = flags.tz ?? config.timezone
    const origin = (key: ConfigKey) =>
      sources[key] === 'env' ? `env ${envVarFor(key)}` : sources[key] === 'file' ? 'config file' : 'not set'
    const shown = (key: ConfigKey) =>
      config[key] === undefined ? '—' : SECRET_KEYS.includes(key) ? '(set, hidden)' : String(config[key])
    const keys: ConfigKey[] = ['url', 'user', 'password', 'cfClientId', 'cfClientSecret', 'userId', 'timezone']
    return {
      data: {
        path: loaded.path,
        fileFound: loaded.fileFound,
        url: config.url ?? null,
        auth: authModes(config),
        user: config.user ?? null,
        cfClientId: config.cfClientId ?? null,
        hasPassword: !!config.password,
        hasCfClientSecret: !!config.cfClientSecret,
        userId: config.userId ?? null,
        timezone: timezone ?? null,
        today: todayIn(timezone, clock()()),
        sources,
        env: Object.fromEntries(keys.map((k) => [k, envVarFor(k)])),
      },
      text: (f) =>
        renderTable(
          [
            ['config file', `${loaded.path}${loaded.fileFound ? '' : ' (not found)'}`],
            ...keys.map((key): [string, string] => [key, `${shown(key)}  [${origin(key)}]`]),
            ['auth', authModes(config).join(' + ')],
            ['today', `${todayIn(timezone, clock()())} in ${timezone ?? 'the system timezone'}`],
          ],
          f,
        ),
    }
  })

  define('doctor', 'check configuration, connection and authentication', () => {}, async (flags) => {
    const checks: Check[] = []
    const add = (name: string, status: Check['status'], detail: string) => checks.push({ name, status, detail })

    let loaded: LoadedConfig | undefined
    try {
      loaded = loadConfig(io.env, flags.config)
      add('config', 'ok', loaded.fileFound ? loaded.path : `${loaded.path} not found; using environment variables`)
    } catch (err) {
      add('config', 'fail', err instanceof Error ? err.message : String(err))
    }

    if (loaded) {
      const { config } = loaded
      if (loaded.fileIsExposed) {
        add('config file', 'warn', `${loaded.path} holds secrets and is readable by other users — run chmod 600`)
      }

      const timezone = flags.tz ?? config.timezone
      try {
        add('timezone', 'ok', `${timezone ?? 'system'} — today is ${todayIn(timezone, clock()())}`)
      } catch (err) {
        add('timezone', 'fail', err instanceof Error ? err.message : String(err))
      }

      let db: HttpDb | undefined
      try {
        db = connect(loaded)
        add('url', 'ok', `${config.url} (auth: ${authModes(config).join(' + ')})`)
      } catch (err) {
        add('url', 'fail', err instanceof Error ? err.message : String(err))
      }

      if (db) {
        let reachable = false
        try {
          const info = await db.info()
          reachable = typeof info?.db_name === 'string'
          if (reachable) add('read', 'ok', `database "${info.db_name}", ${info.doc_count} documents`)
          else add('read', 'fail', 'The URL answers, but not like a CouchDB database — it should end with the database name')
        } catch (err) {
          add('read', 'fail', err instanceof Error ? err.message : String(err))
        }

        if (reachable) {
          try {
            // An empty batch goes through the whole write path without writing anything
            await db.bulkDocs([])
            add('write', 'ok', 'the server accepts writes from these credentials')
          } catch (err) {
            const hint =
              err instanceof AuthError && config.cfClientId
                ? ' — is this service token mapped to a user in the server (BUJO_SERVICE_TOKENS)?'
                : ''
            add('write', 'fail', `${err instanceof Error ? err.message : String(err)}${hint}`)
          }
        }
      }

      if (config.userId) {
        add('userId', 'ok', `writes are stamped with ${config.userId}`)
      } else if (config.cfClientId) {
        add('userId', 'ok', 'not set; the server stamps the user mapped to the service token')
      } else {
        add('userId', 'warn', 'not set: entries written directly to CouchDB will carry no userId (set BUJO_USER_ID)')
      }
    }

    const failed = checks.some((c) => c.status === 'fail')
    return {
      data: { checks },
      text: (f) => renderChecks(checks, f),
      ...(failed ? { exitCode: EXIT_ERROR } : {}),
    }
  })

  // ─── Run ─────────────────────────────────────────────────────────

  function fail(code: string, message: string, exit: number, candidates?: EntryView[]): number {
    if (wantsJson) {
      io.stderr(`${JSON.stringify({ ok: false, error: { code, message, ...(candidates ? { candidates } : {}) } }, null, 2)}\n`)
    } else {
      io.stderr(`error: ${message}\n`)
      if (candidates) {
        const f: Fmt = { color: false, today: '' }
        const shown = candidates.slice(0, 20)
        io.stderr(`${shown.map((c) => entryLine(c, f, { showDate: true })).join('\n')}\n`)
        if (candidates.length > shown.length) io.stderr(`  … and ${candidates.length - shown.length} more\n`)
      }
    }
    return exit
  }

  try {
    // Bare `bujo` (possibly with flags only) shows today
    const flagsOnly = args.every((a) => a.startsWith('-'))
    const asksForInfo = args.some((a) => ['-h', '--help', '-V', '--version'].includes(a))
    await program.parseAsync(flagsOnly && !asksForInfo ? ['today', ...args] : args, { from: 'user' })
    return exitCode
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version "fail" with exit code 0
      if (err.exitCode === 0) return EXIT_OK
      return fail('usage', `${err.message.replace(/^error: /, '')} — see \`bujo --help\``, EXIT_ERROR)
    }
    if (err instanceof AmbiguousError) {
      return fail('ambiguous', err.message, EXIT_NO_MATCH, err.candidates.map(toEntryView))
    }
    if (err instanceof BujoError) {
      return fail(err.code, err.message, err.code === 'not_found' ? EXIT_NO_MATCH : EXIT_ERROR)
    }
    if (err instanceof UsageError) return fail('usage', err.message, EXIT_ERROR)
    if (err instanceof ConfigError) return fail('config', err.message, EXIT_ERROR)
    if (err instanceof AuthError) return fail('auth', err.message, EXIT_ERROR)
    if (err instanceof ConnectionError) return fail('connection', err.message, EXIT_ERROR)
    return fail('error', err instanceof Error ? err.message : String(err), EXIT_ERROR)
  }
}
