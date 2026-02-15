import { assertEquals, assertRejects } from "@std/assert"
import type { LinearClient } from "@linear/sdk"
import { CliError } from "../../errors.ts"
import {
  resolveTeam,
  resolveTeamId,
  resolveUser,
  resolveUserEntity,
} from "../../resolve.ts"

function mockClient(overrides: Partial<LinearClient>): LinearClient {
  return overrides as LinearClient
}

Deno.test("resolveUserEntity and resolveUser share exact/partial semantics", async () => {
  const users = [
    { id: "u1", name: "Jane Smith", email: "jane@example.com" },
    { id: "u2", name: "Janet Stone", email: "janet@example.com" },
    { id: "u3", name: "Alice Doe", email: "alice@example.com" },
  ]
  const client = mockClient({
    viewer: Promise.resolve(users[2] as never),
    users: () => Promise.resolve({ nodes: users } as never),
  })

  const byExactName = await resolveUserEntity(client, "jane smith")
  assertEquals(byExactName.id, "u1")

  const byEmail = await resolveUserEntity(client, "JANET@EXAMPLE.COM")
  assertEquals(byEmail.id, "u2")

  const byPartial = await resolveUserEntity(client, "alice")
  assertEquals(byPartial.id, "u3")

  const meId = await resolveUser(client, "me")
  assertEquals(meId, "u3")

  const parityId = await resolveUser(client, "jane smith")
  assertEquals(parityId, byExactName.id)

  await assertRejects(
    () => resolveUserEntity(client, "jan"),
    CliError,
    'ambiguous user "jan"',
  )

  await assertRejects(
    () => resolveUserEntity(client, "unknown"),
    CliError,
    'user not found: "unknown"',
  )
})

Deno.test("resolveTeam and resolveTeamId share exact/partial semantics", async () => {
  const teams = [
    { id: "t1", key: "POL" },
    { id: "t2", key: "PLAT" },
    { id: "t3", key: "OPS" },
  ]

  const client = mockClient({
    teams: () => Promise.resolve({ nodes: teams } as never),
  })

  const exact = await resolveTeam(client, "pol")
  assertEquals(exact.id, "t1")

  const partial = await resolveTeam(client, "pla")
  assertEquals(partial.id, "t2")

  const parityId = await resolveTeamId(client, "OPS")
  assertEquals(parityId, "t3")

  await assertRejects(
    () => resolveTeam(client, "p"),
    CliError,
    'ambiguous team "p"',
  )

  await assertRejects(
    () => resolveTeam(client, "zzz"),
    CliError,
    'team not found: "zzz"',
  )
})
