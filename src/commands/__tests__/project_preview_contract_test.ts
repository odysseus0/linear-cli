import { assertStringIncludes } from "@std/assert"

Deno.test("project view includes explicit preview metadata fields", async () => {
  const source = await Deno.readTextFile(
    new URL("../project/read.ts", import.meta.url),
  )

  assertStringIncludes(source, "issuePreviewCount")
  assertStringIncludes(source, "issuePreviewLimit")
  assertStringIncludes(source, "issuePreviewHasMore")
  assertStringIncludes(source, "issueTotalCount")
})
