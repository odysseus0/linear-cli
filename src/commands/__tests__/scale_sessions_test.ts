import { assertEquals } from "@std/assert"
import type { LinearClient } from "@linear/sdk"
import { fetchIssueAgentSessions, getLatestSession } from "../issue/index.ts"

type MockConnection<T> = {
  nodes: T[]
  pageInfo: { hasNextPage: boolean }
  fetchNext: () => Promise<MockConnection<T>>
}

function makeConnection<T>(pages: T[][], index = 0): MockConnection<T> {
  return {
    nodes: pages[index] ?? [],
    pageInfo: { hasNextPage: index < pages.length - 1 },
    fetchNext: () => Promise.resolve(makeConnection(pages, index + 1)),
  }
}

function makeSession(
  issueId: string,
  createdAt: string,
  status: string,
  agent: string,
) {
  return {
    issue: Promise.resolve({ id: issueId }),
    appUser: Promise.resolve({ name: agent }),
    status,
    createdAt: new Date(createdAt),
    externalLinks: [{ url: `https://example.com/${agent}` }],
    activities: () =>
      Promise.resolve({
        nodes: [
          {
            content: {
              __typename: "AgentActivityResponseContent",
              body: `summary-${agent}`,
            },
            ephemeral: false,
            createdAt: new Date(createdAt),
          },
        ],
      }),
  }
}

Deno.test("fetchIssueAgentSessions paginates through many pages and filters by issue", async () => {
  const targetIssueId = "issue-target"
  const pages = [
    Array.from(
      { length: 100 },
      (_, i) =>
        i % 2 === 0
          ? makeSession(
            targetIssueId,
            `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
            "complete",
            `a${i}`,
          )
          : makeSession(
            "other",
            `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
            "complete",
            `b${i}`,
          ),
    ),
    Array.from(
      { length: 100 },
      (_, i) =>
        makeSession(
          targetIssueId,
          `2026-01-02T00:${String(i % 60).padStart(2, "0")}:00Z`,
          "complete",
          `c${i}`,
        ),
    ),
    Array.from(
      { length: 60 },
      (_, i) =>
        makeSession(
          "other-2",
          `2026-01-03T00:${String(i % 60).padStart(2, "0")}:00Z`,
          "complete",
          `d${i}`,
        ),
    ),
  ]

  const client = {
    agentSessions: () => Promise.resolve(makeConnection(pages)),
  } as unknown as LinearClient

  const sessions = await fetchIssueAgentSessions(client, targetIssueId, false)
  assertEquals(sessions.length, 150)
  assertEquals(
    sessions.every((s) => s.agent.startsWith("a") || s.agent.startsWith("c")),
    true,
  )
})

Deno.test("getLatestSession returns the newest matching session", async () => {
  const targetIssueId = "issue-target"
  const pages = [[
    makeSession(targetIssueId, "2026-01-01T00:00:00Z", "complete", "old"),
    makeSession(targetIssueId, "2026-01-04T00:00:00Z", "error", "new"),
  ]]

  const client = {
    agentSessions: () => Promise.resolve(makeConnection(pages)),
  } as unknown as LinearClient

  const latest = await getLatestSession(client, targetIssueId)
  assertEquals(latest?.agent, "new")
  assertEquals(latest?.status, "error")
})
