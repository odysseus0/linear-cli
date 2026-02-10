import { Command } from "@cliffy/command"
import { PaginationOrderBy } from "@linear/sdk"
import { createClient } from "../client.ts"
import { CliError } from "../errors.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import type { GlobalOptions } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import {
  readStdin,
  requireTeam,
  resolveIssue,
  resolveLabel,
  resolvePriority,
  resolveProject,
  resolveState,
  resolveTeamId,
  resolveUser,
} from "../resolve.ts"
import { compactTime, formatDate, relativeTime } from "../time.ts"

function priorityIndicator(priority: number): string {
  switch (priority) {
    case 1:
      return "!!!"
    case 2:
      return "!!"
    case 3:
      return "!"
    default:
      return "---"
  }
}

function priorityName(priority: number): string {
  switch (priority) {
    case 1:
      return "Urgent"
    case 2:
      return "High"
    case 3:
      return "Medium"
    case 4:
      return "Low"
    default:
      return "None"
  }
}

const DEFAULT_ACTIVE_STATES = ["triage", "backlog", "unstarted", "started"]

const listCommand = new Command()
  .description("List issues")
  .option("-s, --state <state:string>", "State type filter", {
    collect: true,
  })
  .option("--status <state:string>", "Alias for --state", {
    collect: true,
    hidden: true,
  })
  .option("-a, --assignee <name:string>", "Filter by assignee")
  .option("-U, --unassigned", "Show only unassigned")
  .option("-l, --label <name:string>", "Filter by label", { collect: true })
  .option("-p, --project <name:string>", "Filter by project")
  .option("--sort <field:string>", "Sort: updatedAt, createdAt, priority", {
    default: "updatedAt",
  })
  .option("--limit <n:integer>", "Max results", { default: 50 })
  .option("--include-completed", "Include completed/canceled")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = requireTeam(options)

    // deno-lint-ignore no-explicit-any
    const filter: any = {
      team: { key: { eq: teamKey } },
    }

    // State filter (--status is hidden alias for --state)
    const states = options.state ?? options.status
    const stateTypes = states?.length
      ? states
      : options.includeCompleted
      ? undefined
      : DEFAULT_ACTIVE_STATES

    if (stateTypes) {
      filter.state = { type: { in: stateTypes } }
    }

    // Assignee filter
    if (options.assignee) {
      const userId = await resolveUser(client, options.assignee)
      filter.assignee = { id: { eq: userId } }
    } else if (options.unassigned) {
      filter.assignee = { null: true }
    }

    // Label filter (AND semantics — all must match)
    if (options.label?.length) {
      const teamId = await resolveTeamId(client, teamKey)
      const labelIds = await Promise.all(
        options.label.map((l: string) => resolveLabel(client, teamId, l)),
      )
      filter.labels = { id: { in: labelIds } }
    }

    // Project filter
    if (options.project) {
      const projectId = await resolveProject(client, options.project)
      filter.project = { id: { eq: projectId } }
    }

    // Order
    const orderBy = options.sort === "createdAt"
      ? PaginationOrderBy.CreatedAt
      : PaginationOrderBy.UpdatedAt

    const issues = await client.issues({
      filter,
      first: options.limit || undefined,
      orderBy,
    })

    // Resolve lazy fields
    const rows = await Promise.all(
      issues.nodes.map(async (issue) => {
        const state = await issue.state
        const assignee = await issue.assignee
        return {
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority,
          state: state?.name ?? "-",
          assignee: assignee?.name ?? "-",
          updatedAt: issue.updatedAt,
          url: issue.url,
        }
      }),
    )

    // Client-side priority sort if requested
    if (options.sort === "priority") {
      rows.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
    }

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (rows.length === 0) {
      // Confirm what was resolved when results are empty
      if (options.assignee) {
        const viewer = options.assignee === "me"
          ? await (async () => {
            const v = await client.viewer
            return v.name
          })()
          : options.assignee
        renderMessage(
          format,
          `No issues found for assignee "${viewer}"${
            options.assignee === "me" ? ' (resolved from "me")' : ""
          } in team ${teamKey}`,
        )
      } else {
        renderMessage(format, `No issues found in team ${teamKey}`)
      }
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["\u25CC", "ID", "State", "Assignee", "Title", "Updated"],
        rows: rows.map((r) => [
          priorityIndicator(r.priority),
          r.identifier,
          r.state,
          r.assignee,
          r.title,
          relativeTime(r.updatedAt),
        ]),
      })
    } else {
      render("compact", {
        headers: ["ID", "State", "Assignee", "Title", "Updated"],
        rows: rows.map((r) => [
          r.identifier,
          r.state,
          r.assignee,
          r.title,
          compactTime(r.updatedAt),
        ]),
      })
    }
  })

const viewCommand = new Command()
  .alias("show")
  .description("View issue details")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

    const issue = await resolveIssue(client, id, teamKey)
    const state = await issue.state
    const assignee = await issue.assignee
    const labelsConn = await issue.labels()
    const labels = labelsConn.nodes
    const project = await issue.project
    const cycle = await issue.cycle
    const commentsConn = await issue.comments()
    const comments = commentsConn.nodes

    if (format === "json") {
      const commentData = await Promise.all(
        comments.map(async (c) => {
          const user = await c.user
          return {
            author: user?.name ?? "Unknown",
            body: c.body,
            createdAt: c.createdAt,
          }
        }),
      )
      renderJson({
        id: issue.identifier,
        title: issue.title,
        state: state?.name ?? "-",
        priority: priorityName(issue.priority),
        assignee: assignee?.name ?? null,
        labels: labels.map((l) => l.name),
        project: project?.name ?? null,
        cycle: cycle?.name ?? null,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url,
        description: issue.description ?? null,
        comments: commentData,
      })
      return
    }

    if (format === "compact") {
      const lines = [
        `id\t${issue.identifier}`,
        `title\t${issue.title}`,
        `state\t${state?.name ?? "-"}`,
        `priority\t${priorityName(issue.priority)}`,
        `assignee\t${assignee?.name ?? "-"}`,
        `labels\t${labels.length ? labels.map((l) => l.name).join(", ") : "-"}`,
        `project\t${project?.name ?? "-"}`,
        `cycle\t${cycle?.name ?? "-"}`,
        `created\t${new Date(issue.createdAt).toISOString()}`,
        `updated\t${new Date(issue.updatedAt).toISOString()}`,
        `url\t${issue.url}`,
        `description\t${issue.description ?? "-"}`,
      ]
      console.log(lines.join("\n"))
      return
    }

    // Table format — detail view
    render("table", {
      title: `${issue.identifier}: ${issue.title}`,
      fields: [
        { label: "State", value: state?.name ?? "-" },
        { label: "Priority", value: priorityName(issue.priority) },
        { label: "Assignee", value: assignee?.name ?? "-" },
        {
          label: "Labels",
          value: labels.length ? labels.map((l) => l.name).join(", ") : "-",
        },
        { label: "Project", value: project?.name ?? "-" },
        { label: "Cycle", value: cycle?.name ?? "-" },
        {
          label: "Created",
          value: `${formatDate(issue.createdAt)} (${
            relativeTime(issue.createdAt)
          })`,
        },
        {
          label: "Updated",
          value: `${formatDate(issue.updatedAt)} (${
            relativeTime(issue.updatedAt)
          })`,
        },
        { label: "URL", value: issue.url },
      ],
    })

    if (issue.description) {
      console.log(`\nDescription:\n${issue.description}`)
    }

    if (comments.length > 0) {
      console.log(`\nComments (${comments.length}):`)
      for (const comment of comments) {
        const user = await comment.user
        console.log(
          `  ${user?.name ?? "Unknown"} (${
            relativeTime(comment.createdAt)
          }): ${comment.body}`,
        )
      }
    }
  })

const createCommand = new Command()
  .description("Create issue")
  .option("--title <title:string>", "Issue title", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("-a, --assignee <name:string>", "Assignee name or 'me'")
  .option("-s, --state <state:string>", "Initial state name")
  .option("--status <state:string>", "Alias for --state", { hidden: true })
  .option(
    "--priority <priority:string>",
    "Priority: urgent, high, medium, low, none (or 0-4)",
  )
  .option("-l, --label <name:string>", "Label name", { collect: true })
  .option("-p, --project <name:string>", "Project name")
  .option("--parent <id:string>", "Parent issue identifier")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = requireTeam(options)
    const teamId = await resolveTeamId(client, teamKey)

    // Description: flag → stdin → undefined
    const description = options.description ?? (await readStdin())

    // deno-lint-ignore no-explicit-any
    const input: any = {
      teamId,
      title: options.title,
    }

    if (description) input.description = description
    if (options.priority) input.priority = resolvePriority(options.priority)

    if (options.assignee) {
      input.assigneeId = await resolveUser(client, options.assignee)
    }
    const stateName = options.state ?? options.status
    if (stateName) {
      input.stateId = await resolveState(client, teamId, stateName)
    }
    if (options.label?.length) {
      input.labelIds = await Promise.all(
        options.label.map((l: string) => resolveLabel(client, teamId, l)),
      )
    }
    if (options.project) {
      input.projectId = await resolveProject(client, options.project)
    }
    if (options.parent) {
      const parentIssue = await resolveIssue(client, options.parent, teamKey)
      input.parentId = parentIssue.id
    }

    const payload = await client.createIssue(input)
    const issue = await payload.issue

    if (!issue) {
      throw new Error("failed to create issue")
    }

    if (format === "json") {
      renderJson({
        id: issue.identifier,
        title: issue.title,
        url: issue.url,
      })
      return
    }

    renderMessage(
      format,
      `Created ${issue.identifier}: ${issue.title}\n${issue.url}`,
    )
  })

const updateCommand = new Command()
  .description("Update issue")
  .arguments("<id:string>")
  .option("--title <title:string>", "New title")
  .option("-d, --description <desc:string>", "New description")
  .option("-a, --assignee <name:string>", "New assignee (empty to unassign)")
  .option("-s, --state <state:string>", "New state name")
  .option("--status <state:string>", "Alias for --state", { hidden: true })
  .option(
    "--priority <priority:string>",
    "Priority: urgent, high, medium, low, none (or 0-4)",
  )
  .option("-l, --label <name:string>", "Replace all labels", { collect: true })
  .option("--add-label <name:string>", "Add label", { collect: true })
  .option("--remove-label <name:string>", "Remove label", { collect: true })
  .option("-p, --project <name:string>", "Move to project")
  .option("--parent <id:string>", "Set parent issue")
  .action(async (options, id: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

    const issue = await resolveIssue(client, id, teamKey)

    // deno-lint-ignore no-explicit-any
    const input: any = {}

    if (options.title) input.title = options.title

    // Description: flag → stdin
    const description = options.description ?? (await readStdin())
    if (description !== undefined) input.description = description

    if (options.priority) input.priority = resolvePriority(options.priority)

    if (options.assignee !== undefined) {
      if (options.assignee === "") {
        input.assigneeId = null
      } else {
        input.assigneeId = await resolveUser(client, options.assignee)
      }
    }

    const stateName = options.state ?? options.status
    if (stateName) {
      const state = await issue.state
      const team = await state?.team
      const teamId = team?.id
      if (teamId) {
        input.stateId = await resolveState(client, teamId, stateName)
      }
    }

    // Label operations
    if (options.label?.length) {
      // Replace all labels
      const state = await issue.state
      const team = await state?.team
      const teamId = team?.id ?? ""
      input.labelIds = await Promise.all(
        options.label.map((l: string) => resolveLabel(client, teamId, l)),
      )
    } else if (options.addLabel?.length || options.removeLabel?.length) {
      // Delta label update
      const currentLabels = await issue.labels()
      const currentIds = currentLabels.nodes.map(
        (l: { id: string }) => l.id,
      )

      const state = await issue.state
      const team = await state?.team
      const teamId = team?.id ?? ""

      let labelIds = [...currentIds]

      if (options.addLabel?.length) {
        const addIds = await Promise.all(
          options.addLabel.map((l: string) => resolveLabel(client, teamId, l)),
        )
        labelIds = [...new Set([...labelIds, ...addIds])]
      }

      if (options.removeLabel?.length) {
        const removeIds = await Promise.all(
          options.removeLabel.map((l: string) =>
            resolveLabel(client, teamId, l)
          ),
        )
        labelIds = labelIds.filter((id) => !removeIds.includes(id))
      }

      input.labelIds = labelIds
    }

    if (options.project) {
      input.projectId = await resolveProject(client, options.project)
    }

    if (options.parent) {
      const parentIssue = await resolveIssue(
        client,
        options.parent,
        teamKey,
      )
      input.parentId = parentIssue.id
    }

    await client.updateIssue(issue.id, input)

    // Re-fetch and display updated issue
    const updated = await client.issue(issue.id)
    const updatedState = await updated.state
    const updatedAssignee = await updated.assignee

    if (format === "json") {
      renderJson({
        id: updated.identifier,
        title: updated.title,
        state: updatedState?.name ?? "-",
        assignee: updatedAssignee?.name ?? null,
        url: updated.url,
      })
      return
    }

    render(format === "table" ? "table" : "compact", {
      title: `${updated.identifier}: ${updated.title}`,
      fields: [
        { label: "State", value: updatedState?.name ?? "-" },
        { label: "Priority", value: priorityName(updated.priority) },
        { label: "Assignee", value: updatedAssignee?.name ?? "-" },
        { label: "URL", value: updated.url },
      ],
    })
  })

const deleteCommand = new Command()
  .description("Delete (archive) issue")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

    const issue = await resolveIssue(client, id, teamKey)

    // Confirm if interactive
    if (Deno.stdin.isTerminal()) {
      const buf = new Uint8Array(10)
      const encoder = new TextEncoder()
      await Deno.stdout.write(
        encoder.encode(
          `Delete ${issue.identifier} "${issue.title}"? [y/N] `,
        ),
      )
      const n = await Deno.stdin.read(buf)
      const answer = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
      if (answer.toLowerCase() !== "y") {
        renderMessage(format, "Canceled")
        return
      }
    }

    await client.archiveIssue(issue.id)
    renderMessage(
      format,
      `Deleted ${issue.identifier}: ${issue.title}`,
    )
  })

const commentListCommand = new Command()
  .description("List comments on issue")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

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
  const format = getFormat(options)
  const apiKey = await getAPIKey()
  const client = createClient(apiKey)
  const teamKey = (options as GlobalOptions).team

  const issue = await resolveIssue(client, id, teamKey)

  const body = bodyArg ??
    (options as { body?: string }).body ?? (await readStdin())
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

const commentCommand = new Command()
  .description("Add comment or list comments")
  .arguments("<id:string> [body:string]")
  .option("--body <text:string>", "Comment text (alternative to positional)")
  .action(
    (options: Record<string, unknown>, id: string, bodyArg?: string) =>
      addComment(options, id, bodyArg),
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
      .action(
        (options: Record<string, unknown>, id: string, bodyArg?: string) =>
          addComment(options, id, bodyArg),
      ),
  )
  .command("list", commentListCommand)

const branchCommand = new Command()
  .description("Get git branch name for issue")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

    const issue = await resolveIssue(client, id, teamKey)

    if (format === "json") {
      renderJson({ branchName: issue.branchName })
      return
    }

    console.log(issue.branchName)
  })

export const issueCommand = new Command()
  .description("Manage issues")
  .alias("issues")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("delete", deleteCommand)
  .command("comment", commentCommand)
  .command("branch", branchCommand)
