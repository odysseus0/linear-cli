import { Command } from "@cliffy/command"
import type { Format } from "../../output/formatter.ts"
import { renderMessage } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import { resolveIssue } from "../../resolve.ts"
import { renderMarkdown } from "../../output/markdown.ts"
import { getCommandContext } from "../_shared/context.ts"
import { getLatestSession, TERMINAL_SESSION_STATES } from "./shared.ts"

export { fetchIssueAgentSessions, getLatestSession } from "./shared.ts"

export interface WatchResult {
  issue: string
  agent: string
  status: string
  summary: string | null
  externalUrl: string | null
  elapsed: number
}

export interface WatchTimeoutResult {
  issue: string
  status: "timeout"
  lastSessionStatus: string
  elapsed: number
}

function compactField(value: string | null): string {
  if (!value) return "-"
  const normalized = value.replace(/[\t\r\n]+/g, " ").trim()
  return normalized.length > 0 ? normalized : "-"
}

function renderWatchCompactResult(result: WatchResult): void {
  renderMessage(
    "compact",
    `${compactField(result.issue)}\t${compactField(result.agent)}\t${
      compactField(result.status)
    }\t${result.elapsed}s\t${compactField(result.summary)}\t${
      compactField(result.externalUrl)
    }`,
  )
}

function renderWatchTableResult(result: WatchResult): void {
  renderMessage(
    "table",
    `${result.issue}: ${result.agent} → ${result.status} (${result.elapsed}s)`,
  )
  if (result.summary) {
    renderMessage(
      "table",
      renderMarkdown(result.summary, { indent: "  " }),
    )
  }
  if (result.externalUrl) {
    renderMessage("table", `  View task → ${result.externalUrl}`)
  }
}

function renderWatchTimeoutCompactResult(result: WatchTimeoutResult): void {
  renderMessage(
    "compact",
    `${compactField(result.issue)}\t-\ttimeout\t${result.elapsed}s\t${
      compactField(`timeout waiting for terminal session; last_status=${result.lastSessionStatus}`)
    }\t-`,
  )
}

function renderWatchTimeoutTableResult(result: WatchTimeoutResult): void {
  renderMessage(
    "table",
    `${result.issue}: timeout (${result.elapsed}s)`,
  )
  renderMessage("table", `  Last session status: ${result.lastSessionStatus}`)
}

export function renderWatchResult(format: Format, result: WatchResult): void {
  if (format === "json") {
    renderJson(result)
  } else if (format === "compact") {
    renderWatchCompactResult(result)
  } else {
    renderWatchTableResult(result)
  }
}

export function renderWatchTimeoutResult(
  format: Format,
  result: WatchTimeoutResult,
): void {
  if (format === "json") {
    renderJson(result)
  } else if (format === "compact") {
    renderWatchTimeoutCompactResult(result)
  } else {
    renderWatchTimeoutTableResult(result)
  }
}

export const watchCommand = new Command()
  .description("Watch issue until agent session completes")
  .example("Watch until done", "linear issue watch POL-7")
  .example(
    "Custom interval and timeout",
    "linear issue watch POL-7 --interval 30 --timeout 600",
  )
  .arguments("<id:string>")
  .option("--interval <seconds:number>", "Poll interval in seconds", {
    default: 15,
  })
  .option("--timeout <seconds:number>", "Timeout in seconds (0 = no limit)", {
    default: 0,
  })
  .action(async (options, id: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)
    const interval = (options.interval ?? 15) * 1000
    const timeout = (options.timeout ?? 0) * 1000
    const start = Date.now()

    while (true) {
      const session = await getLatestSession(client, issue.id)

      if (session && TERMINAL_SESSION_STATES.has(session.status)) {
        const result: WatchResult = {
          issue: issue.identifier,
          agent: session.agent,
          status: session.status,
          summary: session.summary,
          externalUrl: session.externalUrl,
          elapsed: Math.round((Date.now() - start) / 1000),
        }

        renderWatchResult(format, result)

        if (session.status === "error") Deno.exit(1)
        if (session.status === "awaitingInput") Deno.exit(2)
        return
      }

      if (timeout > 0 && Date.now() - start > timeout) {
        const status = session ? session.status : "no session"
        const timeoutResult: WatchTimeoutResult = {
          issue: issue.identifier,
          status: "timeout",
          lastSessionStatus: status,
          elapsed: Math.round((Date.now() - start) / 1000),
        }
        renderWatchTimeoutResult(format, timeoutResult)
        Deno.exit(124)
      }

      await new Promise((r) => setTimeout(r, interval))
    }
  })
