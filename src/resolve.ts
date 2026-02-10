import type { Issue, LinearClient } from "@linear/sdk"
import { CliError } from "./errors.ts"

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

/** Resolve team key to team ID. */
export async function resolveTeamId(
  client: LinearClient,
  teamKey: string,
): Promise<string> {
  const teams = await client.teams()
  const team = teams.nodes.find(
    (t) => t.key.toLowerCase() === teamKey.toLowerCase(),
  )
  if (!team) {
    const available = teams.nodes.map((t) => t.key).join(", ")
    throw new CliError(
      `team not found: "${teamKey}"`,
      3,
      `available: ${available}`,
    )
  }
  return team.id
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
  const all = users.nodes

  // Exact match (case-insensitive)
  const exact = all.find(
    (u) => u.name.toLowerCase() === name.toLowerCase(),
  )
  if (exact) return exact.id

  // Email exact match
  const emailExact = all.find(
    (u) => u.email?.toLowerCase() === name.toLowerCase(),
  )
  if (emailExact) return emailExact.id

  // Substring match on name
  const partial = all.filter(
    (u) => u.name.toLowerCase().includes(name.toLowerCase()),
  )
  if (partial.length === 1) return partial[0].id
  if (partial.length > 1) {
    const candidates = partial.map((u) => `${u.name} (${u.email})`).join(", ")
    throw new CliError(
      `ambiguous user "${name}"`,
      4,
      `matches: ${candidates}`,
    )
  }

  const available = all.map((u) => `${u.name} (${u.email})`).join(", ")
  throw new CliError(`user not found: "${name}"`, 3, `available: ${available}`)
}

/** Resolve label name to ID within a team. */
export async function resolveLabel(
  client: LinearClient,
  teamId: string,
  name: string,
): Promise<string> {
  const team = await client.team(teamId)
  const labels = await team.labels()
  const all = labels.nodes

  const exact = all.find(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  )
  if (exact) return exact.id

  const partial = all.filter(
    (l) => l.name.toLowerCase().includes(name.toLowerCase()),
  )
  if (partial.length === 1) return partial[0].id
  if (partial.length > 1) {
    const candidates = partial.map((l) => l.name).join(", ")
    throw new CliError(
      `ambiguous label "${name}"`,
      4,
      `matches: ${candidates}`,
    )
  }

  const available = all.map((l) => l.name).join(", ")
  throw new CliError(
    `label not found: "${name}"`,
    3,
    `available: ${available}`,
  )
}

/** Resolve project name to ID. */
export async function resolveProject(
  client: LinearClient,
  name: string,
): Promise<string> {
  const projects = await client.projects()
  const all = projects.nodes

  const exact = all.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  )
  if (exact) return exact.id

  const partial = all.filter(
    (p) => p.name.toLowerCase().includes(name.toLowerCase()),
  )
  if (partial.length === 1) return partial[0].id
  if (partial.length > 1) {
    const candidates = partial.map((p) => p.name).join(", ")
    throw new CliError(
      `ambiguous project "${name}"`,
      4,
      `matches: ${candidates}`,
    )
  }

  const available = all.map((p) => p.name).join(", ")
  throw new CliError(
    `project not found: "${name}"`,
    3,
    `available: ${available}`,
  )
}

/** Resolve workflow state name to ID within a team. */
export async function resolveState(
  client: LinearClient,
  teamId: string,
  name: string,
): Promise<string> {
  const team = await client.team(teamId)
  const states = await team.states()
  const all = states.nodes

  const exact = all.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  )
  if (exact) return exact.id

  const partial = all.filter(
    (s) => s.name.toLowerCase().includes(name.toLowerCase()),
  )
  if (partial.length === 1) return partial[0].id
  if (partial.length > 1) {
    const candidates = partial.map((s) => s.name).join(", ")
    throw new CliError(
      `ambiguous state "${name}"`,
      4,
      `matches: ${candidates}`,
    )
  }

  const available = all.map((s) => s.name).join(", ")
  throw new CliError(
    `state not found: "${name}"`,
    3,
    `available: ${available}`,
  )
}

/** Parse issue identifier into components. */
export function parseIssueId(
  input: string,
): { teamKey?: string; number?: number; uuid?: string } {
  // UUID
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input,
    )
  ) {
    return { uuid: input }
  }
  // POL-5 format
  const match = input.match(/^([A-Za-z]+)-(\d+)$/)
  if (match) {
    return { teamKey: match[1].toUpperCase(), number: parseInt(match[2]) }
  }
  // Bare number
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

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
}

/** Resolve priority name or number to Linear priority int. */
export function resolvePriority(input: string): number {
  // Numeric
  const num = parseInt(input)
  if (!isNaN(num) && num >= 0 && num <= 4) return num

  // Name
  const mapped = PRIORITY_MAP[input.toLowerCase()]
  if (mapped !== undefined) return mapped

  throw new CliError(
    `invalid priority "${input}"`,
    4,
    `--priority urgent (or: high, medium, low, none, 0-4)`,
  )
}

/** Read description from stdin when not a TTY. */
export async function readStdin(): Promise<string | undefined> {
  if (Deno.stdin.isTerminal()) return undefined
  const text = await new Response(Deno.stdin.readable).text()
  return text.trim() || undefined
}
