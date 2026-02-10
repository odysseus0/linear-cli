# linear-cli: Agent-Native CLI for Linear

## Context

Linear's official MCP server returns unoptimized JSON that burns thousands of
tokens per call. The existing `schpet/linear-cli` (Deno/TypeScript) uses 109
hand-written GraphQL queries instead of Linear's SDK, and is IC-biased (defaults
to `--assignee me`, git branch workflows). Neither tool is designed for AI agent
consumption.

linear-cli is a Deno/TypeScript CLI for Linear built for AI agents managing
work. Uses the official `@linear/sdk` for API interaction (correctness, lazy
fetching, null handling, pagination all handled by the SDK's custom codegen).
Cliffy for Cobra-level CLI framework (subcommands, completions, help, prompts,
tables — all built in). Adds orchestrator-first defaults and token-efficient
output formatting.

**Primary use case:** Claude Code (and similar AI coding agents) managing teams
and issues in Linear as part of an agent orchestration workflow.

**Repo:** `odysseus0/linear-cli`

## Tech Stack

| Component          | Choice                                            | Rationale                                                                                                                                                           |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Deno                                              | Built-in TS, permissions model, `deno compile` for single binary                                                                                                    |
| CLI framework      | Cliffy (`@cliffy/command`)                        | Cobra-equivalent for TS. Subcommands, shell completions, help, prompts, table, ANSI — all built in.                                                                 |
| Linear API         | `npm:@linear/sdk`                                 | Official SDK via Deno npm compat. Custom codegen handles behavioral contract (null→undefined, lazy fetch, pagination, skip internal fields). No raw GraphQL needed. |
| Terminal rendering | Cliffy built-in (`@cliffy/table`, `@cliffy/ansi`) | Colors, column alignment, no extra deps                                                                                                                             |
| Auth storage       | TOML at `~/.config/linear/credentials.toml`       | Compatible with schpet/linear-cli credentials                                                                                                                       |
| Config             | `@std/toml`                                       | Deno stdlib TOML parsing. Global + project-level config                                                                                                             |
| Release            | `deno compile` + GitHub releases                  | Cross-platform binaries, Homebrew tap                                                                                                                               |

## Design Principles

1. **Commands return data, formatters render.** No `console.log` in command
   handlers. Commands populate a result struct, pass to `render()`.

2. **Orchestrator-first defaults.** All assignees, all active states, sort by
   updated. Override with flags to narrow.

3. **Short identifiers everywhere.** Accept `POL-5` and UUIDs as input. Only
   output `POL-5` style identifiers. Never expose UUIDs to the user.

4. **Errors to stderr, data to stdout.** `--format` flag only affects stdout.
   Errors are always plain text on stderr with consistent prefix:
   `error: <message>`. Errors include a `try:` hint line when actionable
   recovery info is available — the hint should contain enough for the caller to
   construct a correct retry without a separate query.

5. **Exit codes are semantic.** 0=success, 1=general error, 2=auth error, 3=not
   found, 4=validation/ambiguity error.

6. **Stdin for long content.** When `--description` is not provided and stdin is
   not a TTY, read stdin as description. Same pattern as `git commit` without
   `-m`.

---

## Global Flags

Available on every command:

| Flag          | Short | Default     | Description                                                                                          |
| ------------- | ----- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `--format`    | `-f`  | Auto-detect | Output format: `table`, `compact`, or `json`. Default: `table` if stdout is TTY, `compact` if piped. |
| `--team`      | `-t`  | From config | Team key (e.g. `POL`). Overrides config default                                                      |
| `--workspace` | `-w`  | From config | Workspace slug. For future multi-workspace support                                                   |
| `--help`      | `-h`  |             | Show help                                                                                            |
| `--version`   | `-v`  |             | Show version                                                                                         |

### Output Formats

**Format auto-detection:** `Deno.stdout.isTerminal()` — TTY defaults to `table`,
pipe defaults to `compact`. `--format` overrides. Agents never need to remember
`--format compact`.

**`table`** (default when TTY) — Human-friendly colored tables:

```
◌   ID     STATE    ASSIGNEE  TITLE                   UPDATED
--- POL-6  Backlog  -         Test issue from MCP     1 min ago
--- POL-5  Backlog  -         Test issue from CLI     1 min ago
!!! POL-1  Todo     Alice     Implement auth module   2 hours ago
```

Priority indicators: `!!!` urgent, `!!` high, `!` medium, `---` none/low. State
names colored by their Linear color. Relative timestamps.

**`compact`** (default when piped) — Tab-delimited with header row for agents:

```
ID	STATE	ASSIGNEE	TITLE	UPDATED
POL-6	Backlog	-	Test issue from MCP	1m
POL-5	Backlog	-	Test issue from CLI	1m
POL-1	Todo	Alice	Implement auth module	2h
```

No colors, no decorations, minimal timestamps (`1m`, `2h`, `3d`). One header
row, then data. Tab-delimited for `cut -f` compatibility.

**`json`** — Full structured data, escape hatch for programmatic use:

```json
[
  {
    "id": "POL-6",
    "state": "Backlog",
    "assignee": null,
    "title": "Test issue from MCP",
    "updatedAt": "2026-02-08T21:16:37Z"
  },
  {
    "id": "POL-1",
    "state": "Todo",
    "assignee": "Alice",
    "title": "Implement auth module",
    "updatedAt": "2026-02-08T19:00:00Z"
  }
]
```

JSON output includes UUIDs alongside short identifiers so consumers can
round-trip data back to the CLI (which accepts both `POL-5` and UUIDs as input).

---

## Config System

**Precedence (highest wins):** CLI flags → environment variables → project
config → global config → defaults

### Credential File

`~/.config/linear/credentials.toml`:

```toml
default = "polytropos"
polytropos = "lin_api_xxxxx"
```

Multi-workspace ready from day one. Single workspace to start — just one entry
plus `default` key.

### Global Config

`~/.config/linear/config.toml`:

```toml
default_team = "POL"
default_format = "table"
```

### Project Config

`.linear.toml` in cwd or git root:

```toml
team = "POL"
```

### Environment Variables

| Variable         | Maps to                              |
| ---------------- | ------------------------------------ |
| `LINEAR_API_KEY` | API key (overrides credentials.toml) |
| `LINEAR_TEAM`    | Default team                         |
| `LINEAR_FORMAT`  | Default format                       |

---

## Commands — Phase 1

### `linear-cli auth login`

Authenticate with Linear.

**Behavior:**

1. If `--key` provided, use it directly
2. If `LINEAR_API_KEY` env var set, use it
3. Otherwise, prompt interactively: "Enter your Linear API key (create at
   https://linear.app/settings/api):"
4. Validate key by calling `client.viewer`
5. Save to `~/.config/linear/credentials.toml` with workspace slug as key
6. Print: `Authenticated as <name> in workspace <workspace>`

**Flags:**

| Flag          | Description               |
| ------------- | ------------------------- |
| `--key <key>` | API key (non-interactive) |

**Exit codes:** 0 success, 2 invalid key, 1 other error

---

### `linear-cli auth logout`

Remove stored credentials.

**Behavior:** Remove the current workspace's entry from credentials.toml. If it
was the default, set default to next available workspace or clear.

**Output:** `Logged out of workspace <workspace>`

---

### `linear-cli auth status`

Show current authentication status.

**Output (authenticated):**

```
Authenticated as George Zhang (george@example.com)
Workspace: polytropos
```

**Output (not authenticated):**

```
error: not authenticated. Run 'linear-cli auth login' first.
```

Exit code 2.

---

### `linear-cli auth whoami`

Print current user info. Shortcut for `auth status` that's more detailed.

**Table output:**

```
NAME           EMAIL                ADMIN  ACTIVE
George Zhang   george@example.com   yes    yes
```

---

### `linear-cli issue list`

List issues. Orchestrator-first defaults: all assignees, all active states,
sorted by updated.

**Flags:**

| Flag                  | Short | Default     | Description                                                                                             |
| --------------------- | ----- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `--state <state>`     | `-s`  | All active  | Filter by state type: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`. Repeatable. |
| `--assignee <name>`   | `-a`  | All         | Filter by assignee name or "me"                                                                         |
| `--unassigned`        | `-U`  | false       | Show only unassigned issues                                                                             |
| `--label <name>`      | `-l`  |             | Filter by label. Repeatable. Multiple = AND (all must match).                                           |
| `--project <name>`    | `-p`  |             | Filter by project name                                                                                  |
| `--sort <field>`      |       | `updatedAt` | Sort: `updatedAt`, `createdAt`, `priority`                                                              |
| `--limit <n>`         |       | 50          | Max results. 0 = unlimited                                                                              |
| `--include-completed` |       | false       | Include completed and canceled issues                                                                   |

**Default behavior (no flags):** Shows all issues in triage, backlog, unstarted,
and started states, for all assignees on the configured team, sorted by most
recently updated. This is the "what's active right now" view.

**Table output:**

```
◌   ID     STATE        ASSIGNEE  TITLE                       UPDATED
!!! POL-7  In Progress  Alice     Fix auth race condition     5 min ago
--- POL-6  Backlog      -         Test issue from MCP         1 hour ago
--- POL-5  Backlog      -         Test issue from CLI         1 hour ago
```

**Compact output:**

```
ID	STATE	ASSIGNEE	TITLE	UPDATED
POL-7	In Progress	Alice	Fix auth race condition	5m
POL-6	Backlog	-	Test issue from MCP	1h
POL-5	Backlog	-	Test issue from CLI	1h
```

---

### `linear-cli issue create`

Create a new issue.

**Flags:**

| Flag                   | Short | Required | Description                                                            |
| ---------------------- | ----- | -------- | ---------------------------------------------------------------------- |
| `--title <title>`      |       | Yes      | Issue title                                                            |
| `--description <desc>` | `-d`  | No       | Issue description. If omitted and stdin is not a TTY, read from stdin. |
| `--assignee <name>`    | `-a`  | No       | Assignee name or "me"                                                  |
| `--state <state>`      | `-s`  | No       | Initial state name (default: team's default state)                     |
| `--priority <n>`       |       | No       | Priority: 1=urgent, 2=high, 3=medium, 4=low                            |
| `--label <name>`       | `-l`  | No       | Label name. Repeatable.                                                |
| `--project <name>`     | `-p`  | No       | Project name                                                           |
| `--parent <id>`        |       | No       | Parent issue identifier (e.g. POL-5) for sub-issues                    |

**Behavior:**

1. Resolve team from `--team` flag or config
2. If `--description` not set and stdin is not a TTY, read stdin as description
3. Resolve assignee and label names to IDs (see Name Resolution)
4. Create issue, print result in current format

**Table output:**

```
Created POL-8: Fix auth race condition
https://linear.app/polytropos/issue/POL-8/fix-auth-race-condition
```

**Compact output:**

```
POL-8	Backlog	Alice	Fix auth race condition	just now
```

**Stdin example:**

```bash
echo "This is a detailed description with **markdown** support." | linear-cli issue create --title "New feature"
```

---

### `linear-cli issue view <id>`

View full issue details.

**Argument:** Issue identifier (e.g. `POL-5`) or UUID.

**Table output:**

```
POL-5: Test issue from CLI
━━━━━━━━━━━━━━━━━━━━━━━━━━━

State:       Backlog
Priority:    None
Assignee:    -
Labels:      -
Project:     -
Cycle:       -
Created:     2026-02-08 (1 hour ago)
Updated:     2026-02-08 (1 hour ago)
URL:         https://linear.app/polytropos/issue/POL-5/test-issue-from-cli

Description:
Comparing CLI vs MCP output

Comments (2):
  Alice (5 min ago): Looks good, let's ship it.
  George (2 min ago): Agreed.
```

**Compact output:** Key-value pairs, one per line:

```
id	POL-5
title	Test issue from CLI
state	Backlog
priority	None
assignee	-
labels	-
project	-
cycle	-
created	2026-02-08T21:16:37Z
updated	2026-02-08T21:16:37Z
url	https://linear.app/polytropos/issue/POL-5/test-issue-from-cli
description	Comparing CLI vs MCP output
```

---

### `linear-cli issue update <id>`

Update issue fields. Only specified flags are changed; unspecified fields are
left untouched.

**Argument:** Issue identifier.

**Flags:**

| Flag                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `--title <title>`       | New title                                                |
| `--description <desc>`  | New description. Stdin supported (same rules as create). |
| `--assignee <name>`     | New assignee. Use "" to unassign.                        |
| `--state <state>`       | New state name                                           |
| `--priority <n>`        | New priority (1-4)                                       |
| `--label <name>`        | Replace all labels. Repeatable.                          |
| `--add-label <name>`    | Add a label without removing existing. Repeatable.       |
| `--remove-label <name>` | Remove a label. Repeatable.                              |
| `--project <name>`      | Move to project                                          |
| `--parent <id>`         | Set parent issue                                         |

**Behavior:**

1. Resolve names to IDs (assignee, labels, project)
2. For label operations: fetch current labels, compute delta, send full label ID
   list
3. Update only changed fields, print updated issue summary

**Output:** Same as `issue view` for the updated issue.

---

### `linear-cli issue delete <id>`

Delete an issue.

**Argument:** Issue identifier.

**Behavior:**

1. If stdin is a TTY, prompt: `Delete POL-5 "Test issue"? [y/N]`
2. If stdin is not a TTY (agent use), delete without confirmation
3. Archive the issue (Linear doesn't truly delete, it archives)

**Output:** `Deleted POL-5: Test issue from CLI`

---

### `linear-cli issue comment list <id>`

List comments on an issue.

**Argument:** Issue identifier.

**Table output:**

```
AUTHOR         AGE        BODY
Alice          5 min ago  Looks good, let's ship it.
George         2 min ago  Agreed.
```

**Compact output:**

```
AUTHOR	AGE	BODY
Alice	5m	Looks good, let's ship it.
George	2m	Agreed.
```

---

### `linear-cli issue comment add <id>`

Add a comment to an issue.

**Argument:** Issue identifier.

**Flags:**

| Flag            | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| `--body <text>` | Comment text. If omitted and stdin is not a TTY, read from stdin. |

**Output:** `Comment added to POL-5`

---

### `linear-cli team list`

List all teams.

**Table output:**

```
KEY  NAME         ISSUES  CYCLES
POL  Polytropos   6       No
ENG  Engineering  142     Yes
```

**Compact output:**

```
KEY	NAME	ISSUES	CYCLES
POL	Polytropos	6	No
ENG	Engineering	142	Yes
```

---

### `linear-cli team view <key>`

View team details.

**Argument:** Team key (e.g. `POL`).

**Table output:**

```
Polytropos (POL)
━━━━━━━━━━━━━━━━

Description:  Main workspace team
Issues:       6
Cycles:       Disabled
Members:      1
Created:      2026-02-08
```

---

### `linear-cli team members <key>`

List team members.

**Argument:** Team key.

**Table output:**

```
NAME           EMAIL                ADMIN  ACTIVE
George Zhang   george@example.com   yes    yes
```

---

### `linear-cli team overview`

Team status dashboard. The orchestrator's primary command.

**Behavior:** Fetch all active issues for the team, group by assignee × state
type, display as matrix.

**Uses `--team` flag or config default.**

**Table output:**

```
Polytropos (POL) — Overview

             Backlog  Todo  In Progress  Done
George       2        1     3            5
Bot-1        0        4     1            2
Bot-2        1        2     0            3
Unassigned   3        0     0            0

Total: 27 issues | 4 in progress | 10 done
```

**Compact output:**

```
ASSIGNEE	BACKLOG	TODO	IN_PROGRESS	DONE
George	2	1	3	5
Bot-1	0	4	1	2
Bot-2	1	2	0	3
Unassigned	3	0	0	0
```

---

### `linear-cli project list`

List projects.

**Flags:**

| Flag                  | Default    | Description                                                     |
| --------------------- | ---------- | --------------------------------------------------------------- |
| `--state <state>`     | All active | Filter: `planned`, `started`, `paused`, `completed`, `canceled` |
| `--include-completed` | false      | Include completed/canceled                                      |

**Table output:**

```
NAME              STATE    PROGRESS  LEAD    TARGET
Auth System       Started  45%       Alice   2026-03-01
API Redesign      Planned  0%        -       2026-04-15
```

**Compact output:**

```
NAME	STATE	PROGRESS	LEAD	TARGET
Auth System	Started	45%	Alice	2026-03-01
API Redesign	Planned	0%	-	2026-04-15
```

---

### `linear-cli project view <id>`

View project details.

**Argument:** Project name or ID.

**Table output:**

```
Auth System
━━━━━━━━━━━

State:       Started
Progress:    45% (9/20 issues)
Lead:        Alice
Target:      2026-03-01
Teams:       POL
Created:     2026-01-15
URL:         https://linear.app/polytropos/project/auth-system

Recent Issues:
  POL-7  In Progress  Alice  Fix auth race condition    5 min ago
  POL-3  Todo         Bob    Add OAuth provider         1 day ago
```

---

### `linear-cli project create`

Create a new project.

**Flags:**

| Flag                   | Required | Description                         |
| ---------------------- | -------- | ----------------------------------- |
| `--name <name>`        | Yes      | Project name                        |
| `--description <desc>` | No       | Description. Stdin supported.       |
| `--lead <name>`        | No       | Project lead                        |
| `--target-date <date>` | No       | Target completion date (YYYY-MM-DD) |

**Output:** `Created project: Auth System` + URL

---

### `linear-cli cycle list`

List cycles for a team. This fills the gap that the Deno CLI and MCP both miss.

**Table output:**

```
#   NAME       STARTS      ENDS        PROGRESS
12  Sprint 12  2026-02-03  2026-02-17  35%
13  Sprint 13  2026-02-17  2026-03-03  0%
```

**Compact output:**

```
NUMBER	NAME	STARTS	ENDS	PROGRESS
12	Sprint 12	2026-02-03	2026-02-17	35%
13	Sprint 13	2026-02-17	2026-03-03	0%
```

---

### `linear-cli cycle view <number>`

View cycle details with its issues.

**Argument:** Cycle number (e.g. `12`).

**Table output:**

```
Sprint 12 (#12)
━━━━━━━━━━━━━━━

Period:     2026-02-03 → 2026-02-17
Progress:   35% (7/20 issues)

Issues:
  POL-7  In Progress  Alice  Fix auth race condition    5 min ago
  POL-3  Todo         Bob    Add OAuth provider         1 day ago
  ...
```

---

## Error Handling

Cliffy handles CLI validation (missing flags, wrong types, unknown commands). We
handle domain errors (not found, ambiguous, auth) with a single error type
carrying an exit code and optional hint.

Error scenarios and hints:

| Scenario                | Exit | Hint                                                      |
| ----------------------- | ---- | --------------------------------------------------------- |
| Not authenticated       | 2    | `run 'linear-cli auth login'`                             |
| Invalid API key         | 2    | `check your API key at linear.app/settings/api`           |
| Issue not found: POL-99 | 3    | (none)                                                    |
| User not found: "bob"   | 3    | `available: Alice (alice@co.com), George (george@co.com)` |
| Ambiguous user: "al"    | 4    | `matches: Alice (alice@co.com), Alan (alan@co.com)`       |
| Team not found: "FOO"   | 3    | `available: POL, ENG`                                     |
| No team specified       | 4    | `use --team or set default_team in config`                |

The hint contains candidates from the failed resolution — no extra API call
needed since the resolver already has them in scope.

---

## Name Resolution

Several commands accept human-friendly names that must be resolved to Linear
IDs:

- **Assignee:** `--assignee Alice` → fetch users, find by name match
  (case-insensitive substring), get ID
- **Labels:** `--label bug` → fetch team labels, find by name match, get ID
- **Projects:** `--project "Auth System"` → fetch projects, find by name match,
  get ID
- **Teams:** `--team POL` → the team key IS the identifier (no resolution
  needed)

Resolution strategy: exact match (case-insensitive) → substring match → error
with candidates.

If one substring match: use it (no ambiguity).

If multiple substring matches:

```
error: ambiguous user "al"
  try: Alice (alice@co.com), Alan (alan@co.com)
```

If zero matches:

```
error: user not found: "bob"
  try: Alice (alice@co.com), George (george@co.com)
```

Candidates come from the same query that failed — no extra API call.

### Identifier Resolution

All commands that accept issue/project identifiers detect format by shape:

- `POL-5` → identifier lookup (uppercase, prepend team key if numeric only)
- `550e8400-e29b-41d4-...` → UUID, pass directly to SDK
- UUIDs accepted as input (for round-tripping from `--format json`) but never
  output in `table` or `compact` formats
