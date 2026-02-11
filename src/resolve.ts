import type { Document, Initiative, Issue, LinearClient } from "@linear/sdk"
import { CliError } from "./errors.ts"

// ---------------------------------------------------------------------------
// Generic entity resolver
// ---------------------------------------------------------------------------

interface ResolveOpts<T> {
  /** All candidate entities. */
  items: T[]
  /** User input to match against. */
  input: string
  /** Primary match field (e.g., name, title). */
  key: (item: T) => string
  /** Optional alternate match fields (e.g., email). */
  altKeys?: (item: T) => string[]
  /** Entity type name for error messages. */
  entity: string
  /** Format a candidate for disambiguation display. Defaults to key(). */
  display?: (item: T) => string
}

/**
 * Resolve a human-friendly string to a single entity.
 *
 * Resolution chain (first match wins):
 *   1. Exact match on primary key (case-insensitive)
 *   2. Exact match on any alt key (case-insensitive)
 *   3. Unique substring match on primary key
 *   3b. Unique substring match on alt keys
 *   4. Ambiguous → error listing candidates
 *   5. Not found → error listing all available
 */
function resolve<T>(opts: ResolveOpts<T>): T {
  const { items, input, key, altKeys, entity, display } = opts
  const lower = input.toLowerCase()
  const fmt = display ?? key

  // 1. Exact match on primary key
  const exact = items.find((item) => key(item).toLowerCase() === lower)
  if (exact) return exact

  // 2. Exact match on alt keys
  if (altKeys) {
    for (const item of items) {
      if (altKeys(item).some((k) => k.toLowerCase() === lower)) {
        return item
      }
    }
  }

  // 3. Substring match on primary key
  const partial = items.filter((item) =>
    key(item).toLowerCase().includes(lower)
  )
  if (partial.length === 1) return partial[0]

  // 3b. Substring match on alt keys
  let combined = partial
  if (altKeys) {
    const altPartial = items.filter((item) =>
      !partial.includes(item) &&
      altKeys(item).some((k) => k.toLowerCase().includes(lower))
    )
    combined = [...partial, ...altPartial]
    if (combined.length === 1) return combined[0]
  }

  if (combined.length > 1) {
    const candidates = combined.map((p) => fmt(p)).join(", ")
    throw new CliError(
      `ambiguous ${entity} "${input}"`,
      4,
      `matches: ${candidates}`,
    )
  }

  // 4. Not found
  const available = items.map((item) => fmt(item)).join(", ")
  throw new CliError(
    `${entity} not found: "${input}"`,
    3,
    `available: ${available}`,
  )
}

// ---------------------------------------------------------------------------
// UUID helper
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Option helpers
// ---------------------------------------------------------------------------

/** Extract team key from options or env, throw if missing. */
export function requireTeam(options: unknown): string {
  const team = (options as { team?: string }).team ??
    Deno.env.get("LINEAR_TEAM")
  if (!team) {
    throw new CliError(
      "no team specified",
      4,
      "use --team or set LINEAR_TEAM",
    )
  }
  return team
}

// ---------------------------------------------------------------------------
// Entity resolvers — thin wrappers around resolve()
// ---------------------------------------------------------------------------

/** Resolve team key to team ID. */
export async function resolveTeamId(
  client: LinearClient,
  teamKey: string,
): Promise<string> {
  const teams = await client.teams()
  return resolve({
    items: teams.nodes,
    input: teamKey,
    key: (t) => t.key,
    entity: "team",
    display: (t) => t.key,
  }).id
}

/** Resolve user name to ID. Supports "me" for current viewer. */
export async function resolveUser(
  client: LinearClient,
  name: string,
): Promise<string> {
  if (name === "me") {
    const viewer = await client.viewer
    return viewer.id
  }

  const users = await client.users()
  return resolve({
    items: users.nodes,
    input: name,
    key: (u) => u.name,
    altKeys: (u) => [u.email ?? ""],
    entity: "user",
    display: (u) => `${u.name} (${u.email})`,
  }).id
}

/** Resolve label name to ID within a team. */
export async function resolveLabel(
  client: LinearClient,
  teamId: string,
  name: string,
): Promise<string> {
  const team = await client.team(teamId)
  const labels = await team.labels()
  return resolve({
    items: labels.nodes,
    input: name,
    key: (l) => l.name,
    entity: "label",
  }).id
}

/** Resolve project name to ID. */
export async function resolveProject(
  client: LinearClient,
  name: string,
): Promise<string> {
  const projects = await client.projects()
  return resolve({
    items: projects.nodes,
    input: name,
    key: (p) => p.name,
    entity: "project",
  }).id
}

/** Resolve project name to full Project object. */
export async function resolveProjectByName(
  client: LinearClient,
  name: string,
) {
  const projects = await client.projects()
  return resolve({
    items: projects.nodes,
    input: name,
    key: (p) => p.name,
    entity: "project",
  })
}

/** Resolve workflow state name to ID within a team. */
export async function resolveState(
  client: LinearClient,
  teamId: string,
  name: string,
): Promise<string> {
  const team = await client.team(teamId)
  const states = await team.states()
  return resolve({
    items: states.nodes,
    input: name,
    key: (s) => s.name,
    entity: "state",
  }).id
}

/** Resolve document by title or UUID. Returns full Document. */
export async function resolveDocument(
  client: LinearClient,
  titleOrId: string,
): Promise<Document> {
  if (UUID_RE.test(titleOrId)) {
    return await client.document(titleOrId)
  }

  const docs = await client.documents()
  return resolve({
    items: docs.nodes,
    input: titleOrId,
    key: (d) => d.title,
    entity: "document",
  })
}

/** Resolve initiative by name or UUID. Returns full Initiative. */
export async function resolveInitiative(
  client: LinearClient,
  nameOrId: string,
): Promise<Initiative> {
  if (UUID_RE.test(nameOrId)) {
    return await client.initiative(nameOrId)
  }

  const initiatives = await client.initiatives()
  return resolve({
    items: initiatives.nodes,
    input: nameOrId,
    key: (i) => i.name,
    entity: "initiative",
  })
}

// ---------------------------------------------------------------------------
// Issue resolution (different pattern — identifier parsing + API filter)
// ---------------------------------------------------------------------------

/** Parse issue identifier into components. */
export function parseIssueId(
  input: string,
): { teamKey?: string; number?: number; uuid?: string } {
  if (UUID_RE.test(input)) {
    return { uuid: input }
  }
  const match = input.match(/^([A-Za-z]+)-(\d+)$/)
  if (match) {
    return { teamKey: match[1].toUpperCase(), number: parseInt(match[2]) }
  }
  const num = parseInt(input)
  if (!isNaN(num)) {
    return { number: num }
  }
  throw new CliError(`invalid issue identifier: "${input}"`, 4)
}

/** Resolve issue by identifier (POL-5) or UUID. */
export async function resolveIssue(
  client: LinearClient,
  identifier: string,
  teamKey?: string,
): Promise<Issue> {
  const parsed = parseIssueId(identifier)

  if (parsed.uuid) {
    try {
      return await client.issue(parsed.uuid)
    } catch {
      throw new CliError(`issue not found: ${identifier}`, 3)
    }
  }

  const key = parsed.teamKey ?? teamKey
  if (!key && parsed.number !== undefined) {
    throw new CliError(
      "no team specified for issue lookup",
      4,
      "use full identifier (POL-5) or --team flag",
    )
  }

  const issues = await client.issues({
    filter: {
      team: { key: { eq: key } },
      number: { eq: parsed.number },
    },
  })

  if (issues.nodes.length === 0) {
    throw new CliError(`issue not found: ${key}-${parsed.number}`, 3)
  }

  return issues.nodes[0]
}

// ---------------------------------------------------------------------------
// Priority resolution (enum mapping, not entity lookup)
// ---------------------------------------------------------------------------

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
}

/** Resolve priority name or number to Linear priority int. */
export function resolvePriority(input: string): number {
  const num = parseInt(input)
  if (!isNaN(num) && num >= 0 && num <= 4) return num

  const mapped = PRIORITY_MAP[input.toLowerCase()]
  if (mapped !== undefined) return mapped

  throw new CliError(
    `invalid priority "${input}"`,
    4,
    `--priority urgent (or: high, medium, low, none, 0-4)`,
  )
}

// ---------------------------------------------------------------------------
// Stdin helper
// ---------------------------------------------------------------------------

/** Read description from stdin when not a TTY. */
export async function readStdin(): Promise<string | undefined> {
  if (Deno.stdin.isTerminal()) return undefined
  const text = await new Response(Deno.stdin.readable).text()
  return text.trim() || undefined
}
