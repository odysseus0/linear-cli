import { assertEquals, assertStringIncludes } from "@std/assert"
import {
  buildMutationResult,
  renderMutationOutput,
} from "../_shared/mutation_output.ts"

function captureConsoleLog(run: () => void): string[] {
  const logs: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args.map((v) => String(v)).join(" "))
  }
  try {
    run()
  } finally {
    console.log = original
  }
  return logs
}

Deno.test("renderMutationOutput prints standardized JSON payload", () => {
  const result = buildMutationResult({
    id: "POL-1",
    entity: "issue",
    action: "close",
    status: "success",
    url: "https://linear.app/example/issue/POL-1",
    metadata: { state: "Done" },
  })

  const logs = captureConsoleLog(() => {
    renderMutationOutput({
      format: "json",
      result,
    })
  })

  assertEquals(logs.length, 1)
  const payload = JSON.parse(logs[0]) as Record<string, unknown>
  assertEquals(payload.id, "POL-1")
  assertEquals(payload.status, "success")
  assertStringIncludes(String(payload.url), "linear.app")
})

Deno.test("renderMutationOutput prints compact output from the same DTO", () => {
  const result = buildMutationResult({
    id: "POL-1",
    entity: "issue",
    action: "close",
    status: "success",
    metadata: { state: "Done" },
  })

  const logs = captureConsoleLog(() => {
    renderMutationOutput({
      format: "compact",
      result,
    })
  })

  assertStringIncludes(logs.join("\n"), "ok\ttrue")
  assertStringIncludes(logs.join("\n"), "entity\tissue")
  assertStringIncludes(logs.join("\n"), "action\tclose")
  assertStringIncludes(logs.join("\n"), "id\tPOL-1")
  assertStringIncludes(logs.join("\n"), "status\tsuccess")
})
