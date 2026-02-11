import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { relativeTime } from "../time.ts"

interface InboxItem {
  type: string
  actor: string
  issue: string
  title: string
  summary: string
  read: boolean
  count: number
  createdAt: string | Date
}

export const inboxCommand = new Command()
  .description("View inbox notifications")
  .alias("notifications")
  .option("--unread", "Show only unread notifications")
  .option("--all", "Show individual notifications (don't group by issue)")
  .option("--limit <n:number>", "Max notifications to fetch", { default: 50 })
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const notifs = await client.notifications({
      first: options.limit ?? 50,
    })

    let items = notifs.nodes
    if (options.unread) {
      items = items.filter((n) => !n.readAt)
    }

    // Resolve all notifications
    const resolved = await Promise.all(
      items.map(async (n) => {
        // deno-lint-ignore no-explicit-any
        const nAny = n as any
        const issue = nAny.issue ? await nAny.issue : null
        const actor = nAny.actor ? await nAny.actor : null
        const comment = nAny.comment ? await nAny.comment : null

        // Build a content summary from whatever we have
        const summary = buildSummary(n.type, actor?.name, comment?.body)

        return {
          type: n.type,
          actor: actor?.name ?? "-",
          issue: issue?.identifier ?? "-",
          title: issue?.title ?? "-",
          summary,
          read: !!n.readAt,
          createdAt: n.createdAt,
        }
      }),
    )

    // Group by issue (default) or show all
    let rows: InboxItem[]
    if (options.all) {
      rows = resolved.map((r) => ({ ...r, count: 1 }))
    } else {
      const grouped = new Map<string, InboxItem>()
      for (const r of resolved) {
        const existing = grouped.get(r.issue)
        if (!existing) {
          grouped.set(r.issue, { ...r, count: 1 })
        } else {
          existing.count++
          if (
            new Date(r.createdAt) > new Date(existing.createdAt)
          ) {
            existing.type = r.type
            existing.actor = r.actor
            existing.summary = r.summary
            existing.createdAt = r.createdAt
          }
          if (!r.read) existing.read = false
        }
      }
      rows = [...grouped.values()]
    }

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (rows.length === 0) {
      console.log(options.unread ? "Inbox zero." : "No notifications.")
      return
    }

    render(format, {
      headers: ["", "Issue", "Title", "Summary", "When"],
      rows: rows.map((r) => {
        const countSuffix = r.count > 1 ? ` (+${r.count - 1})` : ""
        return [
          r.read ? " " : "●",
          r.issue,
          truncate(r.title, 35),
          truncate(r.summary, 50) + countSuffix,
          relativeTime(r.createdAt),
        ]
      }),
    })
  })

/** Build a human-readable summary line from notification data. */
function buildSummary(
  type: string,
  actorName: string | undefined,
  commentBody: string | undefined,
): string {
  const actor = actorName ?? "Someone"

  if (commentBody) {
    // Strip markdown, collapse whitespace, take first line
    const clean = commentBody
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return `${actor}: ${clean}`
  }

  // Fallback to formatted type
  const action = type
    .replace(/^issue/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
  return `${actor} — ${action}`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}
