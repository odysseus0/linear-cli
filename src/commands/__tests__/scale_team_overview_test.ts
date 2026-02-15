import { assertEquals } from "@std/assert"
import type { LinearClient } from "@linear/sdk"
import { fetchTeamOverviewIssues } from "../team.ts"

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

Deno.test("team overview issue fetch paginates beyond 200 records", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `i-${i}` }))
  const secondPage = Array.from({ length: 100 }, (_, i) => ({
    id: `i-${100 + i}`,
  }))
  const thirdPage = Array.from(
    { length: 35 },
    (_, i) => ({ id: `i-${200 + i}` }),
  )

  let capturedFirst: unknown
  const client = {
    issues: (args: unknown) => {
      capturedFirst = args
      return Promise.resolve(makeConnection([firstPage, secondPage, thirdPage]))
    },
  } as unknown as LinearClient

  const issues = await fetchTeamOverviewIssues(client, "POL")

  assertEquals(issues.length, 235)
  assertEquals((issues[0] as { id: string }).id, "i-0")
  assertEquals((issues[234] as { id: string }).id, "i-234")
  assertEquals(
    (capturedFirst as { first?: number }).first,
    100,
  )
})
