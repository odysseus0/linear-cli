import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { relativeTime } from "../time.ts"

export const inboxCommand = new Command()
  .description("View inbox notifications")
  .alias("notifications")
  .option("--unread", "Show only unread notifications")
  .option("--limit <n:number>", "Max notifications to show", { default: 25 })
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const notifs = await client.notifications({
      first: options.limit ?? 25,
    })

    let items = notifs.nodes
    if (options.unread) {
      items = items.filter((n) => !n.readAt)
    }

    const rows = await Promise.all(
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
          snoozed: !!n.snoozedUntilAt,
          createdAt: n.createdAt,
        }
      }),
    )

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (rows.length === 0) {
      console.log(options.unread ? "Inbox zero." : "No notifications.")
      return
    }

    render(format, {
      headers: ["", "Type", "Actor", "Issue", "Title", "When"],
      rows: rows.map((r) => [
        r.read ? " " : "●",
        r.type,
        r.actor,
        r.issue,
        r.title.length > 50 ? r.title.slice(0, 47) + "..." : r.title,
        relativeTime(r.createdAt),
      ]),
    })
  })

function formatType(type: string): string {
  // issueNewComment → comment, issueAssignedToYou → assigned, etc.
  return type
    .replace(/^issue/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
}
