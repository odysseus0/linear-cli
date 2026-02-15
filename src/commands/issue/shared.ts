import type { LinearClient } from "@linear/sdk"

export function priorityIndicator(priority: number): string {
  switch (priority) {
    case 1:
      return "!!!"
    case 2:
      return "!!"
    case 3:
      return "!"
    default:
      return "---"
  }
}

export function priorityName(priority: number): string {
  switch (priority) {
    case 1:
      return "Urgent"
    case 2:
      return "High"
    case 3:
      return "Medium"
    case 4:
      return "Low"
    default:
      return "None"
  }
}

export const DEFAULT_ACTIVE_STATES = [
  "triage",
  "backlog",
  "unstarted",
  "started",
]

export const TERMINAL_SESSION_STATES = new Set([
  "complete",
  "error",
  "awaitingInput",
])

interface SessionActivityView {
  type: string
  body: string
  ephemeral: boolean
  createdAt: string | Date
}

export interface AgentSessionView {
  agent: string
  status: string
  createdAt: string | Date
  summary: string | null
  externalUrl: string | null
  activities: SessionActivityView[] | null
}

export async function fetchIssueAgentSessions(
  client: LinearClient,
  issueId: string,
  verbose: boolean,
): Promise<AgentSessionView[]> {
  let connection = await client.agentSessions({ first: 50 })
  const sessions = [...connection.nodes]

  while (connection.pageInfo.hasNextPage) {
    connection = await connection.fetchNext()
    sessions.push(...connection.nodes)
  }

  const filtered = []
  for (const session of sessions) {
    const sessionIssue = await session.issue
    if (sessionIssue?.id !== issueId) continue
    filtered.push(session)
  }

  return await Promise.all(
    filtered.map(async (session) => {
      const appUser = await session.appUser
      const activities = await session.activities()
      const responseActivity = activities.nodes.find(
        (a) => a.content.__typename === "AgentActivityResponseContent",
      )
      const summary = responseActivity?.content.__typename ===
          "AgentActivityResponseContent"
        ? responseActivity.content.body
        : null
      return {
        agent: appUser?.name ?? "Unknown",
        status: session.status,
        createdAt: session.createdAt,
        summary,
        // externalUrls is typed as Record<string, unknown> in SDK but is actually { url: string }[]
        externalUrl: session.externalLinks?.[0]?.url ??
          (session.externalUrls as unknown as { url?: string }[] | undefined)
            ?.[0]?.url ??
          null,
        activities: verbose
          ? activities.nodes.map((a) => ({
            type: a.content.__typename
              .replace("AgentActivity", "")
              .replace("Content", "")
              .toLowerCase(),
            body: "body" in a.content ? a.content.body : "",
            ephemeral: a.ephemeral,
            createdAt: a.createdAt,
          }))
          : null,
      }
    }),
  )
}

/** Find the latest agent session for an issue. Returns null if none. */
export async function getLatestSession(
  client: LinearClient,
  issueId: string,
): Promise<AgentSessionView | null> {
  const sessions = await fetchIssueAgentSessions(client, issueId, false)
  let latest: AgentSessionView | null = null
  for (const session of sessions) {
    if (!latest || new Date(session.createdAt) > new Date(latest.createdAt)) {
      latest = session
    }
  }
  return latest
}
