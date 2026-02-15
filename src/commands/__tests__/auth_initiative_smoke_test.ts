import { assert, assertStringIncludes } from "@std/assert"

Deno.test("auth status/whoami/logout use shared command context", async () => {
  const source = await Deno.readTextFile(
    new URL("../auth.ts", import.meta.url),
  )

  assertStringIncludes(source, "await getCommandContext(options)")
  assert(source.includes('.description("Show authentication status")'))
  assert(source.includes('.description("Show current user")'))
  assert(source.includes('.description("Remove stored credentials")'))
})

Deno.test("initiative list/view use shared context and centralized status parser", async () => {
  const source = await Deno.readTextFile(
    new URL("../initiative.ts", import.meta.url),
  )

  assertStringIncludes(
    source,
    "const { format, client } = await getCommandContext(options)",
  )
  assertStringIncludes(source, "function parseInitiativeStatus(input: string)")
  assertStringIncludes(source, "initiativeStatusLabel(")
  assertStringIncludes(source, "parseInitiativeStatus(options.status)")
  assert(!source.includes("const statusMap: Record<string, InitiativeStatus>"))
})
