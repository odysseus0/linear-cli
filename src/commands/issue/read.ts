import { Command } from "@cliffy/command"
import { PaginationOrderBy } from "@linear/sdk"
import { CliError } from "../../errors.ts"
import { render, renderMessage } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import {
  resolveIssue,
  resolveLabel,
  resolvePriority,
  resolveProject,
  resolveTeam,
  resolveTeamId,
  resolveUser,
} from "../../resolve.ts"
import { compactTime, formatDate, relativeTime } from "../../time.ts"
import { renderMarkdown } from "../../output/markdown.ts"
import { getCommandContext } from "../_shared/context.ts"
import {
  DEFAULT_ACTIVE_STATES,
  fetchIssueAgentSessions,
  priorityIndicator,
  priorityName,
} from "./shared.ts"

export const listCommand = new Command()
  .description("List issues")
  .example("List team issues", "linear issue list --team POL")
  .example("List my issues", "linear issue list --team POL --assignee me")
  .example("Urgent issues", "linear issue list --team POL --priority urgent")
  .example("Current cycle", "linear issue list --team POL --cycle current")
  .example("Overdue issues", "linear issue list --team POL --overdue")
  .option("-s, --state <state:string>", "State type filter", { collect: true })
  .option("--status <state:string>", "Alias for --state", {
    collect: true,
    hidden: true,
  })
  .option("-a, --assignee <name:string>", "Filter by assignee")
  .option("-U, --unassigned", "Show only unassigned")
  .option("-l, --label <name:string>", "Filter by label", { collect: true })
  .option("-p, --project <name:string>", "Filter by project")
  .option(
    "--priority <priority:string>",
    "Filter by priority: urgent, high, medium, low, none (or 0-4)",
  )
  .option(
    "--cycle <cycle:string>",
    "Filter by cycle: current, next, or cycle number",
  )
  .option("--due <date:string>", "Issues due on or before date (YYYY-MM-DD)")
  .option("--overdue", "Show only overdue issues (past due date)")
  .option("--sort <field:string>", "Sort: updated, created, priority", {
    default: "updatedAt",
  })
  .option("--limit <n:integer>", "Max results", { default: 50 })
  .option("--include-completed", "Include completed/canceled")
  .option("--mine", "Only my issues (shorthand for --assignee me)", {
    hidden: true,
  })
  .action(async (options) => {
    const { format, client, teamKey } = await getCommandContext(options, {
      requireTeam: true,
    })

    const states = options.state ?? options.status
    const stateTypes = states?.length
      ? states
      : options.includeCompleted
      ? undefined
      : DEFAULT_ACTIVE_STATES

    const assigneeName = options.assignee ?? (options.mine ? "me" : undefined)
    const userId = assigneeName
      ? await resolveUser(client, assigneeName)
      : undefined

    const teamId = (options.label?.length || options.cycle)
      ? await resolveTeamId(client, teamKey)
      : undefined
    const labelIds = options.label?.length && teamId
      ? await Promise.all(
        options.label.map((l: string) => resolveLabel(client, teamId, l)),
      )
      : undefined

    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined

    let cycleId: string | undefined
    if (options.cycle) {
      const team = await resolveTeam(client, teamKey)
      const cycles = await team.cycles()
      const now = new Date()

      if (options.cycle === "current") {
        const current = cycles.nodes.find((
          c: { startsAt: Date; endsAt: Date },
        ) => new Date(c.startsAt) <= now && now <= new Date(c.endsAt))
        if (!current) {
          throw new CliError(
            "no active cycle found",
            3,
            "list cycles with: linear cycle list --team " + teamKey,
          )
        }
        cycleId = current.id
      } else if (options.cycle === "next") {
        const future = cycles.nodes
          .filter((c: { startsAt: Date }) => new Date(c.startsAt) > now)
          .sort((a: { startsAt: Date }, b: { startsAt: Date }) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
          )
        if (future.length === 0) {
          throw new CliError(
            "no upcoming cycle found",
            3,
            "list cycles with: linear cycle list --team " + teamKey,
          )
        }
        cycleId = future[0].id
      } else {
        if (!/^\d+$/.test(options.cycle)) {
          throw new CliError(
            `invalid cycle "${options.cycle}"`,
            4,
            "--cycle current, --cycle next, or --cycle <number>",
          )
        }
        const num = Number(options.cycle)
        const match = cycles.nodes.find((c: { number: number }) =>
          c.number === num
        )
        if (!match) {
          throw new CliError(
            `cycle #${num} not found`,
            3,
            "list cycles with: linear cycle list --team " + teamKey,
          )
        }
        cycleId = match.id
      }
    }

    if (options.due && !/^\d{4}-\d{2}-\d{2}$/.test(options.due)) {
      throw new CliError(`invalid date "${options.due}"`, 4, "--due YYYY-MM-DD")
    }
    const dueDate = (options.due || options.overdue)
      ? {
        ...(options.due && { lte: options.due }),
        ...(options.overdue && { lt: new Date().toISOString().slice(0, 10) }),
      }
      : undefined

    const filter = {
      team: { key: { eq: teamKey } },
      ...(stateTypes && { state: { type: { in: stateTypes } } }),
      ...(userId && { assignee: { id: { eq: userId } } }),
      ...(options.unassigned && !assigneeName && { assignee: { null: true } }),
      ...(labelIds && { labels: { id: { in: labelIds } } }),
      ...(projectId && { project: { id: { eq: projectId } } }),
      ...(options.priority &&
        { priority: { eq: resolvePriority(options.priority) } }),
      ...(cycleId && { cycle: { id: { eq: cycleId } } }),
      ...(dueDate && { dueDate }),
    }

    const sortMap: Record<string, string> = {
      updated: "updatedAt",
      created: "createdAt",
    }
    const sortField = sortMap[options.sort] ?? options.sort

    const orderBy = sortField === "createdAt"
      ? PaginationOrderBy.CreatedAt
      : PaginationOrderBy.UpdatedAt

    if (Deno.stderr.isTerminal()) {
      Deno.stderr.writeSync(new TextEncoder().encode("Fetching...\r"))
    }

    const issues = await client.issues({
      filter,
      first: options.limit || undefined,
      orderBy,
    })

    const rows = await Promise.all(
      issues.nodes.map(async (issue) => {
        const state = await issue.state
        const assignee = await issue.assignee
        const delegate = await issue.delegate
        return {
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority,
          state: state?.name ?? "-",
          assignee: assignee?.name ?? "-",
          delegate: delegate?.name ?? null,
          updatedAt: issue.updatedAt,
          url: issue.url,
        }
      }),
    )

    if (sortField === "priority") {
      rows.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
    }

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (rows.length === 0) {
      if (options.assignee) {
        const viewer = options.assignee === "me"
          ? await (async () => (await client.viewer).name)()
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

    const hasDelegate = rows.some((r) => r.delegate)

    if (format === "table") {
      const headers = ["\u25CC", "ID", "State", "Assignee"]
      if (hasDelegate) headers.push("Delegate")
      headers.push("Title", "Updated")
      render("table", {
        headers,
        rows: rows.map((r) => {
          const row = [
            priorityIndicator(r.priority),
            r.identifier,
            r.state,
            r.assignee,
          ]
          if (hasDelegate) row.push(r.delegate ?? "-")
          row.push(r.title, relativeTime(r.updatedAt))
          return row
        }),
      })
    } else {
      const headers = ["ID", "State", "Assignee"]
      if (hasDelegate) headers.push("Delegate")
      headers.push("Title", "Updated")
      render("compact", {
        headers,
        rows: rows.map((r) => {
          const row = [r.identifier, r.state, r.assignee]
          if (hasDelegate) row.push(r.delegate ?? "-")
          row.push(r.title, compactTime(r.updatedAt))
          return row
        }),
      })
    }
  })

export const viewCommand = new Command()
  .alias("show")
  .description("View issue details")
  .example("View an issue", "linear issue view POL-5")
  .arguments("<id:string>")
  .option("-v, --verbose", "Show full agent activity log")
  .action(async (options, id: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)
    const state = await issue.state
    const assignee = await issue.assignee
    const delegate = await issue.delegate
    const labelsConn = await issue.labels()
    const labels = labelsConn.nodes
    const project = await issue.project
    const cycle = await issue.cycle
    const commentsConn = await issue.comments()
    const comments = commentsConn.nodes

    const branchName = await issue.branchName
    const sessions = await fetchIssueAgentSessions(
      client,
      issue.id,
      Boolean((options as { verbose?: boolean }).verbose),
    )

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

    const payload = {
      id: issue.identifier,
      title: issue.title,
      state: state?.name ?? "-",
      priority: priorityName(issue.priority),
      assignee: assignee?.name ?? null,
      delegate: delegate?.name ?? null,
      labels: labels.map((l) => l.name),
      project: project?.name ?? null,
      cycle: cycle?.name ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      url: issue.url,
      branchName: branchName ?? null,
      description: issue.description ?? null,
      comments: commentData,
      agentSessions: sessions,
    }

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "compact") {
      const lines = [
        `id\t${payload.id}`,
        `title\t${payload.title}`,
        `state\t${payload.state}`,
        `priority\t${payload.priority}`,
        `assignee\t${payload.assignee ?? "-"}`,
        `delegate\t${payload.delegate ?? "-"}`,
        `labels\t${payload.labels.length ? payload.labels.join(", ") : "-"}`,
        `project\t${payload.project ?? "-"}`,
        `cycle\t${payload.cycle ?? "-"}`,
        `created\t${new Date(payload.createdAt).toISOString()}`,
        `updated\t${new Date(payload.updatedAt).toISOString()}`,
        `url\t${payload.url}`,
        `branch\t${payload.branchName ?? "-"}`,
        `description\t${payload.description ?? "-"}`,
      ]
      if (payload.agentSessions.length > 0) {
        for (const session of payload.agentSessions) {
          lines.push(
            `agent_session\t${session.agent}\t${session.status}\t${
              session.summary?.replace(/\n/g, " ").slice(0, 200) ?? "-"
            }\t${session.externalUrl ?? "-"}`,
          )
        }
      }
      renderMessage(format, lines.join("\n"))
      return
    }

    render("table", {
      title: `${payload.id}: ${payload.title}`,
      fields: [
        { label: "State", value: payload.state },
        { label: "Priority", value: payload.priority },
        { label: "Assignee", value: payload.assignee ?? "-" },
        { label: "Delegate", value: payload.delegate ?? "-" },
        {
          label: "Labels",
          value: payload.labels.length ? payload.labels.join(", ") : "-",
        },
        { label: "Project", value: payload.project ?? "-" },
        { label: "Cycle", value: payload.cycle ?? "-" },
        {
          label: "Created",
          value: `${formatDate(payload.createdAt)} (${
            relativeTime(payload.createdAt)
          })`,
        },
        {
          label: "Updated",
          value: `${formatDate(payload.updatedAt)} (${
            relativeTime(payload.updatedAt)
          })`,
        },
        { label: "URL", value: payload.url },
        { label: "Branch", value: payload.branchName ?? "-" },
      ],
    })

    if (payload.description) {
      renderMessage(
        format,
        `\nDescription:\n${renderMarkdown(payload.description)}`,
      )
    }

    if (payload.comments.length > 0) {
      const commentsBlock = payload.comments.map((comment) =>
        `\n${comment.author} (${relativeTime(comment.createdAt)}):\n${
          renderMarkdown(comment.body, { indent: "  " })
        }`
      ).join("\n")
      renderMessage(
        format,
        `\nComments (${payload.comments.length}):${commentsBlock}`,
      )
    }

    if (payload.agentSessions.length > 0) {
      const sessionBlocks = payload.agentSessions.map((session) => {
        const statusLabel = session.status === "complete"
          ? "complete"
          : session.status === "awaitingInput"
          ? "needs input"
          : session.status === "error"
          ? "error"
          : session.status
        const lines = [
          `\n${session.agent} · ${statusLabel} · ${
            relativeTime(session.createdAt)
          }`,
        ]
        if (session.summary) {
          lines.push(renderMarkdown(session.summary, { indent: "  " }))
        }
        if (session.externalUrl) {
          lines.push(`  View task → ${session.externalUrl}`)
        }
        if (session.activities) {
          lines.push("  Activities:")
          for (const act of session.activities) {
            const raw = act.body.length > 120
              ? act.body.slice(0, 117) + "..."
              : act.body
            lines.push(
              `    [${act.type}] ${renderMarkdown(raw, { indent: "    " })}`,
            )
          }
        }
        return lines.join("\n")
      }).join("\n")
      renderMessage(
        format,
        `\nAgent Sessions (${payload.agentSessions.length}):${sessionBlocks}`,
      )
    }
  })

export const branchCommand = new Command()
  .description("Get git branch name for issue")
  .example("Get branch name", "linear issue branch POL-5")
  .arguments("<id:string>")
  .action(async (options, id: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)
    const payload = { branchName: issue.branchName }

    if (format === "json") {
      renderJson(payload)
      return
    }

    renderMessage(format, payload.branchName)
  })
