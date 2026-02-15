import { Command } from "@cliffy/command"
import { CliError } from "../../errors.ts"
import { render, renderMessage } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import { readStdin, resolveIssue } from "../../resolve.ts"
import { compactTime, relativeTime } from "../../time.ts"
import { getCommandContext } from "../_shared/context.ts"

export const commentListCommand = new Command()
  .description("List comments on issue")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)
    const commentsConn = await issue.comments()
    const comments = commentsConn.nodes

    const rows = await Promise.all(
      comments.map(async (c) => {
        const user = await c.user
        return {
          author: user?.name ?? "Unknown",
          body: c.body ?? "",
          createdAt: c.createdAt,
        }
      }),
    )

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Author", "Age", "Body"],
        rows: rows.map((r) => [
          r.author,
          relativeTime(r.createdAt),
          r.body.length > 80 ? r.body.slice(0, 77) + "..." : r.body,
        ]),
      })
    } else {
      render("compact", {
        headers: ["Author", "Age", "Body"],
        rows: rows.map((r) => [
          r.author,
          compactTime(r.createdAt),
          r.body.replace(/\n/g, " "),
        ]),
      })
    }
  })

async function addComment(
  options: unknown,
  id: string,
  bodyArg?: string,
): Promise<void> {
  const { format, client } = await getCommandContext(options)
  const teamKey = (options as unknown as { team?: string }).team

  const issue = await resolveIssue(client, id, teamKey)

  const body = bodyArg ?? (options as { body?: string }).body ??
    (await readStdin())
  if (!body) {
    throw new CliError(
      "comment body required",
      4,
      `issue comment ${id} "your comment" (or --body or pipe via stdin)`,
    )
  }

  await client.createComment({ issueId: issue.id, body })
  renderMessage(format, `Comment added to ${issue.identifier}`)
}

export const commentCommand = new Command()
  .description("Add comment or list comments")
  .example("Add a comment", "linear issue comment POL-5 'Looks good'")
  .example("List comments", "linear issue comment list POL-5")
  .arguments("<id:string> [body:string]")
  .option("--body <text:string>", "Comment text (alternative to positional)")
  .action((options: Record<string, unknown>, id: string, bodyArg?: string) =>
    addComment(options, id, bodyArg)
  )
  .command(
    "add",
    new Command()
      .description("Add comment to issue")
      .arguments("<id:string> [body:string]")
      .option(
        "--body <text:string>",
        "Comment text (alternative to positional)",
      )
      .action((
        options: Record<string, unknown>,
        id: string,
        bodyArg?: string,
      ) => addComment(options, id, bodyArg)),
  )
  .command("list", commentListCommand)
