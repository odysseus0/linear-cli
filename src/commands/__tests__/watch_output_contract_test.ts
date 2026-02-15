import { assertEquals, assertStringIncludes } from "@std/assert"
import {
  renderWatchResult,
  renderWatchTimeoutResult,
  type WatchResult,
  type WatchTimeoutResult,
} from "../issue/watch.ts"

interface CaptureResult {
  out: string[]
  err: string[]
}

function captureStreams(run: () => void): CaptureResult {
  const out: string[] = []
  const err: string[] = []
  const originalLog = console.log
  const originalStderrWrite = Deno.stderr.writeSync
  console.log = (...args: unknown[]) => {
    out.push(args.map((v) => String(v)).join(" "))
  }
  Deno.stderr.writeSync = ((p: Uint8Array) => {
    err.push(new TextDecoder().decode(p))
    return p.length
  }) as typeof Deno.stderr.writeSync

  try {
    run()
  } finally {
    console.log = originalLog
    Deno.stderr.writeSync = originalStderrWrite
  }

  return { out, err }
}

const watchResult: WatchResult = {
  issue: "POL-7",
  agent: "Linear Agent",
  status: "complete",
  summary: "First line.\nSecond line with details.",
  externalUrl: "https://linear.app/example/task/1",
  elapsed: 42,
}

Deno.test("watch compact result prints complete summary on stdout", () => {
  const logs = captureStreams(() => renderWatchResult("compact", watchResult))
  assertEquals(logs.err.length, 0)
  assertEquals(logs.out.length, 1)

  const row = logs.out[0]
  assertStringIncludes(row, "POL-7")
  assertStringIncludes(row, "Linear Agent")
  assertStringIncludes(row, "complete")
  assertStringIncludes(row, "42s")
  assertStringIncludes(row, "First line. Second line with details.")
  assertStringIncludes(row, "https://linear.app/example/task/1")
})

Deno.test("watch json timeout payload is structured", () => {
  const timeout: WatchTimeoutResult = {
    issue: "POL-7",
    status: "timeout",
    lastSessionStatus: "started",
    elapsed: 120,
  }
  const logs = captureStreams(() => renderWatchTimeoutResult("json", timeout))
  assertEquals(logs.err.length, 0)
  assertEquals(logs.out.length, 1)

  const payload = JSON.parse(logs.out[0]) as Record<string, unknown>
  assertEquals(payload.issue, "POL-7")
  assertEquals(payload.status, "timeout")
  assertEquals(payload.lastSessionStatus, "started")
  assertEquals(payload.elapsed, 120)
})

Deno.test("watch table timeout prints final status on stdout", () => {
  const timeout: WatchTimeoutResult = {
    issue: "POL-7",
    status: "timeout",
    lastSessionStatus: "no session",
    elapsed: 30,
  }
  const logs = captureStreams(() => renderWatchTimeoutResult("table", timeout))
  assertEquals(logs.err.length, 0)
  assertEquals(logs.out.length, 2)
  assertStringIncludes(logs.out[0], "POL-7: timeout (30s)")
  assertStringIncludes(logs.out[1], "Last session status: no session")
})
