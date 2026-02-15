import { assertEquals } from "@std/assert"
import { render } from "../../output/formatter.ts"

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

Deno.test("formatter compact table snapshot", () => {
  const logs = captureConsoleLog(() => {
    render("compact", {
      headers: ["ID", "State"],
      rows: [["POL-1", "Todo"], ["POL-2", "Done"]],
    })
  })

  assertEquals(logs.join("\n"), "ID\tSTATE\nPOL-1\tTodo\nPOL-2\tDone")
})

Deno.test("formatter compact detail snapshot", () => {
  const logs = captureConsoleLog(() => {
    render("compact", {
      title: "Issue",
      fields: [
        { label: "ID", value: "POL-1" },
        { label: "State", value: "Todo" },
      ],
    })
  })

  assertEquals(logs.join("\n"), "id\tPOL-1\nstate\tTodo")
})
