import { assertStringIncludes } from "@std/assert"

Deno.test("issue porcelain mutations define standardized action ids", async () => {
  const issueSource = await Deno.readTextFile(
    new URL("../issue/mutate.ts", import.meta.url),
  )

  for (const action of ["close", "reopen", "start", "assign"]) {
    assertStringIncludes(issueSource, `action: "${action}"`)
  }
})

Deno.test("project porcelain mutations define standardized action ids", async () => {
  const projectMutateSource = await Deno.readTextFile(
    new URL("../project/mutate.ts", import.meta.url),
  )
  const projectStatusSource = await Deno.readTextFile(
    new URL("../project/status.ts", import.meta.url),
  )
  const projectSource = `${projectMutateSource}\n${projectStatusSource}`

  for (
    const action of [
      "start",
      "pause",
      "complete",
      "cancel",
      "moveToProject",
    ]
  ) {
    assertStringIncludes(projectSource, `action: "${action}"`)
  }
})

Deno.test("initiative porcelain mutations define standardized action ids", async () => {
  const initiativeSource = await Deno.readTextFile(
    new URL("../initiative.ts", import.meta.url),
  )

  for (const action of ["start", "complete"]) {
    assertStringIncludes(initiativeSource, `action: "${action}"`)
  }
})
