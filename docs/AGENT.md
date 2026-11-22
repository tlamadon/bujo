# Using `bujo` as an agent

`bujo` is the command line for the user's Bullet Journal. This is the short version of how to drive it; `bujo --help` and the README have the full reference.

## Ground rules

- **Always pass `--json`.** You get exactly one JSON object on stdout. On failure stdout is empty, the error is JSON on stderr, and the exit code is non-zero.
- **Exit codes:** `0` ok · `1` error · `2` your reference matched no entry, or several.
- **Target entries by `ref`.** Every entry in every response has a 6-character `ref`. It never changes, even when the entry is moved, so you can keep it across commands and across days. (`id` does change on a move; an old `id` still resolves.)
- **It never prompts** when you are not on a terminal. `rm`, and `drop` with several refs, need `--yes` or they exit 1.
- **Do not guess.** If a command exits 2 with `error.code: "ambiguous"`, pick from `error.candidates` or ask the user. Nothing was changed.
- Every response carries `today` (the user's date, in their timezone). Use it instead of your own idea of the date.

## What to use when

| The user wants to… | Command |
|---|---|
| capture a task | `bujo add "Call plumber #house" --json` |
| …for another day | `--date tomorrow` · `mon` · `+3d` · `next-week` · `2026-12-24` |
| …for "some time this week" | `--week` (`--week next`, `--date 2026-W48`) |
| …for "some time in March" | `--month 2027-03` (or `--date 2027-03`) |
| …with no date | `--date unscheduled` |
| capture an event | `bujo add "Dentist" --time 14:30 --date mon --json` |
| capture a note | `bujo add "Boiler serviced" --note --json` |
| flag something as important | `--priority` on `add`, or `bujo prio <ref>` |
| see today | `bujo today --json` |
| see the week / month | `bujo week --json` · `bujo month --json` (`+1`, `-1` for next / last) |
| see what is coming | `bujo future --json` |
| see a project or area | `bujo tag house --open --json` |
| check something off | `bujo done <ref> --json` |
| cancel something | `bujo drop <ref> --json` |
| undo either | `bujo undo <ref> --json` |
| postpone | `bujo move <ref> tomorrow --json` |
| park it for later | `bujo schedule <ref> 2027-01 --json` or `… unscheduled` |
| reword | `bujo edit <ref> "new text #tags" --json` |
| find something | `bujo search "passport" --json` · `bujo show <ref> --json` |
| set something to achieve this week / month | `bujo add "Ship v2" --week --json` · `--month` · `--week next` |
| break something into steps | `bujo add "Write the changelog" --parent <ref> --json` |
| file an existing task under another | `bujo parent <ref> <epic ref> --json` (`none` to detach) |

Typical capture, then acting on what you captured:

```console
$ bujo add "Call plumber about the leak #house" --priority --json
{ "ok": true, "command": "add", "today": "2026-11-21",
  "entry": { "ref": "we6zzh", "status": "task", "date": "2026-11-21", "tags": ["house"], "priority": true, … } }

$ bujo done we6zzh --json
{ "ok": true, "command": "done", "today": "2026-11-21",
  "entries": [ { "ref": "we6zzh", "status": "completed", "open": false, … } ] }
```

## What comes back

An entry, wherever it appears:

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
  "parent": { "ref": "k3m9qa", "text": "Clear out the house" },
  "subtasks": null,
  "dateHistory": ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"],
  "moves": 4,
  "createdAt": "2026-11-21T17:14:45.938Z"
}
```

- `status`: `task`, `completed`, `dropped`, `note`, `event`. Use `open` to ask "is this still to do?".
- `date` / `dateKind`: a day (`2026-11-21`), a week (`2026-W47`: some time that week), a month (`2026-11`: some time that month) or `"unscheduled"`.
- `text` is `body` without the `#tags` — say that to the user; send `body` back when editing.
- `moves` is how often it has been rescheduled; `dateHistory` is where it has been.
- `parent` is the epic the entry is a subtask of (`{ ref, text }`), or `null`.
- `subtasks` is `{ done, total }` on an epic — a task that has subtasks — and `null` on everything else.

Views wrap entries like this:

| Command | Shape |
|---|---|
| `today` | `{ date, weekday, isToday, week, entries[], ghosts[], overdue[] }` |
| `week` | `{ week, start, end, undated[], days[]: { date, weekday, isToday, entries[], ghosts[] } }` |
| `month` | `{ month, undated[], open[], events[], days[]: { date, counts } }` |
| `future` | `{ unscheduled[], months[]: { month, entries[] } }` |
| `tag` | `{ tag, open, total, entries[] }` |
| `show` | `{ entry, subtasks[], ghostDates[] }` |
| `review` | `{ period, counts, monthTasks[], completed[], open[], dropped[], migrated[], stale[] }` |

`undated` holds what is dated to the week or month as a whole, with no day yet. `entries` are in reading order: open tasks first (priority ones on top), then events by time, notes, completed, dropped. `ghosts` are entries that *were* on that day and moved away; their `date` is where they are now. Do not report ghosts as things to do on that day.

## Daily routine

1. `bujo today --json`. If `overdue` is not empty, there are open tasks left behind: on earlier days, in earlier weeks or months.
2. `bujo migrate --dry-run --json` to see them, then `bujo migrate --json` to carry them forward. Each keeps its grain: a day task comes to today, a week task to the current week, a month task to the current month. Migrating is what the user does in the app each morning; it is safe to repeat (a second run moves nothing). Ask before migrating if the user has not asked for it before.
3. Read the day back to the user from `entries`: open tasks, then events with their `time`.

## Conventions

**Tags are collections.** A `#tag` in the text files the entry under that tag — a project, an area, a person (`#house`, `#work`, `#hermes`). Reuse the user's existing tags rather than inventing near-duplicates: check `bujo tags --json` first. `bujo tag <name> --open --json` is the to-do list of a collection.

**A week or a month can hold tasks of its own.** What the user wants to get done "this week" or "in March", without a day yet, is a task dated to that week or month: `bujo add "…" --week`, `--month`. These show under `undated` in `week` / `month`, and count in reviews like any other task. There is no separate "goal" kind: a goal is such a task. (`bujo goal "…"` still works, as a short form of `add --week`.)

**Epics.** A task with subtasks is an epic. Use one when something takes several steps: date the epic to the week or month it should be done in, and put its subtasks on days (`bujo add "…" --parent <ref> --date mon`). An epic reports `subtasks: { done, total }`; a subtask reports its `parent`. Nothing cascades — when the last subtask is done, *ask* whether the epic is done and then `done <ref>` it; completing an epic does not touch its subtasks. Subtasks cannot have subtasks. For loose grouping without a "done" of its own, a `#tag` is still the tool.

**The future log** is for things further out: `--month 2027-03` means "some time in March", `--date unscheduled` means "some day". They appear in `bujo future`.

**Dropping is not deleting.** `drop` keeps the entry, struck through, as a record of a decision. Use `rm --yes` only when the user wants something gone (a mistake, a duplicate).

**Stale tasks → ask "drop or do?"** A task that keeps being moved is a decision the user is avoiding. `bujo stale --json` lists open tasks with `moves >= 3`. Do not silently migrate these forever: put the question to the user — do it (when?), drop it, or park it (`schedule <ref> unscheduled`).

## Reviews

`bujo review week --json` (or `month`; add `-1` for the period that just ended) is read-only and returns everything in one call:

```json
{
  "kind": "week", "period": "2026-W47", "start": "2026-11-16", "end": "2026-11-22", "current": true,
  "counts": { "completed": 2, "open": 2, "dropped": 1, "migrated": 0, "events": 0, "notes": 1 },
  "monthTasks": [ { "month": "2026-11", "entries": [ … ] } ],
  "completed": [ … ], "open": [ … ], "dropped": [ … ], "migrated": [ … ],
  "stale": [ … ], "staleMinMoves": 3
}
```

A weekly review, in order:

1. **The week's own tasks** — entries in `completed` / `open` / `dropped` with `dateKind: "week"` are what the user set out to do this week (often epics: read their `subtasks`). For open ones ask: done (`done <ref>`), carry over (`move <ref> 2026-W48`; `migrate` will also do it once the week is over), or let go (`drop <ref>`). `monthTasks` gives the month's larger aims for context.
2. **Done** — summarise `completed`; it is worth saying out loud.
3. **Still open** — `open` are tasks still dated inside the period. For each: do it, `move` it to a specific day, or `schedule` it to the future log.
4. **Migrated** — `migrated` were carried out of the period. Mention the count; look at `moves` for repeat offenders.
5. **Stale** — for each entry in `stale`, ask "drop or do?".
6. **Next period** — offer to set what it is for: `bujo add "…" --week next --json`.

A monthly review is the same with `bujo review month --json`, plus `bujo future --json` to pull next month's items out of the future log (`move <ref> <day>`).

## When something fails

| `error.code` | Exit | What to do |
|---|---|---|
| `not_found` | 2 | The ref or text matched nothing. Search (`bujo search …`) or ask |
| `ambiguous` | 2 | Choose from `error.candidates` by `ref`, or ask |
| `invalid` | 1 | Bad date, time or text; `error.message` says what is accepted |
| `usage` | 1 | Wrong arguments, or `--yes` missing for `rm` / bulk `drop` |
| `config`, `auth`, `connection` | 1 | Setup problem. Run `bujo doctor --json` and show the user the failing check |
