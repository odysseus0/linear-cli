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
        return {
          type: formatType(n.type),
          actor: actor?.name ?? "-",
          issue: issue?.identifier ?? "-",
          title: issue?.title ?? "-",
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
      // Group by issue, keep latest per issue
      const grouped = new Map<string, InboxItem>()
      for (const r of resolved) {
        const existing = grouped.get(r.issue)
        if (!existing) {
          grouped.set(r.issue, { ...r, count: 1 })
        } else {
          existing.count++
          // Keep the latest type/actor and unread if any are unread
          if (
            new Date(r.createdAt) > new Date(existing.createdAt)
          ) {
            existing.type = r.type
            existing.actor = r.actor
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
      headers: ["", "Issue", "Title", "Latest", "Actor", "When"],
      rows: rows.map((r) => [
        r.read ? " " : "●",
        r.issue,
        r.title.length > 45 ? r.title.slice(0, 42) + "..." : r.title,
        r.type + (r.count > 1 ? ` (${r.count})` : ""),
        r.actor,
        relativeTime(r.createdAt),
      ]),
    })
  })

function formatType(type: string): string {
  return type
    .replace(/^issue/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
}
