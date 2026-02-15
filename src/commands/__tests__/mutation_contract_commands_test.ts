import { assertStringIncludes } from "@std/assert"

Deno.test("issue porcelain mutations define standardized action ids", async () => {
  const issueSource = await Deno.readTextFile(
    new URL("../issue.ts", import.meta.url),
  )

  for (const action of ["close", "reopen", "start", "assign"]) {
    assertStringIncludes(issueSource, `action: "${action}"`)
  }
})

Deno.test("project porcelain mutations define standardized action ids", async () => {
  const projectSource = await Deno.readTextFile(
    new URL("../project.ts", import.meta.url),
  )

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
