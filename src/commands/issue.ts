import { Command } from "@cliffy/command"
import { type LinearClient, PaginationOrderBy } from "@linear/sdk"
// Exit codes: 0 success, 1 runtime error, 2 auth error, 3 not found, 4 validation/usage
import { CliError } from "../errors.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import {
  readStdin,
  resolveIssue,
  resolveLabel,
  resolvePriority,
  resolveProject,
  resolveState,
  resolveTeamId,
  resolveUser,
} from "../resolve.ts"
import { compactTime, formatDate, relativeTime } from "../time.ts"
import { renderMarkdown } from "../output/markdown.ts"
import { confirmDangerousAction } from "./_shared/confirm.ts"
import { getCommandContext } from "./_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "./_shared/mutation_output.ts"

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
  .example("List team issues", "linear issue list --team POL")
  .example("List my issues", "linear issue list --team POL --assignee me")
  .example("Urgent issues", "linear issue list --team POL --priority urgent")
  .example("Current cycle", "linear issue list --team POL --cycle current")
  .example("Overdue issues", "linear issue list --team POL --overdue")
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

    // --- Resolve all filter values ---

    // State filter (--status is hidden alias for --state)
    const states = options.state ?? options.status
    const stateTypes = states?.length
      ? states
      : options.includeCompleted
      ? undefined
      : DEFAULT_ACTIVE_STATES

    // --mine is shorthand for --assignee me (--assignee wins if both set)
    const assigneeName = options.assignee ?? (options.mine ? "me" : undefined)
    const userId = assigneeName
      ? await resolveUser(client, assigneeName)
      : undefined

    // Label filter (AND semantics — all must match)
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

    // Cycle resolution (requires team → cycles)
    let cycleId: string | undefined
    if (options.cycle) {
      const teams = await client.teams()
      const team = teams.nodes.find(
        (t: { key: string }) => t.key.toLowerCase() === teamKey.toLowerCase(),
      )
      if (!team) {
        throw new CliError(
          `team not found: "${teamKey}"`,
          3,
          "check team key with: linear team list",
        )
      }
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

    // Due date (--due and --overdue can combine)
    if (options.due && !/^\d{4}-\d{2}-\d{2}$/.test(options.due)) {
      throw new CliError(`invalid date "${options.due}"`, 4, "--due YYYY-MM-DD")
    }
    const dueDate = (options.due || options.overdue)
      ? {
        ...(options.due && { lte: options.due }),
        ...(options.overdue && { lt: new Date().toISOString().slice(0, 10) }),
      }
      : undefined

    // --- Build filter ---
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

    // Normalize human-friendly sort values
    const sortMap: Record<string, string> = {
      updated: "updatedAt",
      created: "createdAt",
    }
    const sortField = sortMap[options.sort] ?? options.sort

    // Order
    const orderBy = sortField === "createdAt"
      ? PaginationOrderBy.CreatedAt
      : PaginationOrderBy.UpdatedAt

    // Progress indication for slow list fetch
    if (Deno.stderr.isTerminal()) {
      Deno.stderr.writeSync(new TextEncoder().encode("Fetching...\r"))
    }

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

    // Client-side priority sort if requested
    if (sortField === "priority") {
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

const viewCommand = new Command()
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

    // Fetch agent sessions for this issue
    const allSessions = await client.agentSessions()
    const sessions = []
    for (const session of allSessions.nodes) {
      const sessionIssue = await session.issue
      if (sessionIssue?.id === issue.id) {
        const appUser = await session.appUser
        const activities = await session.activities()
        // Find the last response activity (the summary/result)
        const responseActivity = activities.nodes.find(
          (a) => a.content.__typename === "AgentActivityResponseContent",
        )
        const summary = responseActivity?.content.__typename ===
            "AgentActivityResponseContent"
          ? responseActivity.content.body
          : null
        sessions.push({
          agent: appUser?.name ?? "Unknown",
          status: session.status,
          createdAt: session.createdAt,
          summary,
          // externalUrls is typed as Record<string, unknown> in SDK but is actually { url: string }[]
          externalUrl: session.externalLinks?.[0]?.url ??
            (session.externalUrls as unknown as { url?: string }[] | undefined)
              ?.[0]?.url ??
            null,
          activities: (options as { verbose?: boolean }).verbose
            ? activities.nodes.map((a) => ({
              type: a.content.__typename
                .replace("AgentActivity", "")
                .replace("Content", "")
                .toLowerCase(),
              body: "body" in a.content ? a.content.body : "",
              ephemeral: a.ephemeral,
              createdAt: a.createdAt,
            }))
            : null,
        })
      }
    }

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
      console.log(lines.join("\n"))
      return
    }

    // Table format — detail view
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
      console.log(
        `\nDescription:\n${renderMarkdown(payload.description)}`,
      )
    }

    if (payload.comments.length > 0) {
      console.log(`\nComments (${payload.comments.length}):`)
      for (const comment of payload.comments) {
        console.log(
          `\n${comment.author} (${relativeTime(comment.createdAt)}):\n${
            renderMarkdown(comment.body, { indent: "  " })
          }`,
        )
      }
    }

    if (payload.agentSessions.length > 0) {
      console.log(`\nAgent Sessions (${payload.agentSessions.length}):`)
      for (const session of payload.agentSessions) {
        const statusLabel = session.status === "complete"
          ? "complete"
          : session.status === "awaitingInput"
          ? "needs input"
          : session.status === "error"
          ? "error"
          : session.status
        console.log(
          `\n${session.agent} · ${statusLabel} · ${
            relativeTime(session.createdAt)
          }`,
        )
        if (session.summary) {
          console.log(renderMarkdown(session.summary, { indent: "  " }))
        }
        if (session.externalUrl) {
          console.log(`  View task → ${session.externalUrl}`)
        }
        if (session.activities) {
          console.log(`  Activities:`)
          for (const act of session.activities) {
            const raw = act.body.length > 120
              ? act.body.slice(0, 117) + "..."
              : act.body
            console.log(
              `    [${act.type}] ${renderMarkdown(raw, { indent: "    " })}`,
            )
          }
        }
      }
    }
  })

const createCommand = new Command()
  .description("Create issue")
  .example(
    "Create a bug",
    "linear issue create --team POL --title 'Login crash' --priority urgent --label bug",
  )
  .example(
    "Create and assign to me",
    "linear issue create --team POL --title 'Fix tests' --assignee me",
  )
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
  .option("--type <type:string>", "Alias for --label", { hidden: true })
  .option("-p, --project <name:string>", "Project name")
  .option("--parent <id:string>", "Parent issue identifier")
  .action(async (options) => {
    const { format, client, teamKey } = await getCommandContext(options, {
      requireTeam: true,
    })
    const teamId = await resolveTeamId(client, teamKey)

    // Description: flag → stdin → undefined
    const description = options.description ?? (await readStdin())

    // Resolve all async values before building input
    const stateName = options.state ?? options.status
    const assigneeId = options.assignee
      ? await resolveUser(client, options.assignee)
      : undefined
    const stateId = stateName
      ? await resolveState(client, teamId, stateName)
      : undefined
    const labelNames = options.label?.length
      ? options.label
      : options.type
      ? [options.type]
      : undefined
    const labelIds = labelNames?.length
      ? await Promise.all(
        labelNames.map((l: string) => resolveLabel(client, teamId, l)),
      )
      : undefined
    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined
    const parentId = options.parent
      ? (await resolveIssue(client, options.parent, teamKey)).id
      : undefined

    const payload = await client.createIssue({
      teamId,
      title: options.title,
      ...(description && { description }),
      ...(options.priority && { priority: resolvePriority(options.priority) }),
      ...(assigneeId && { assigneeId }),
      ...(stateId && { stateId }),
      ...(labelIds && { labelIds }),
      ...(projectId && { projectId }),
      ...(parentId && { parentId }),
    })
    const issue = await payload.issue

    if (!issue) {
      throw new CliError("failed to create issue", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: issue.identifier,
        entity: "issue",
        action: "create",
        status: "success",
        url: issue.url,
        metadata: { title: issue.title },
      }),
    })
    if (format === "table") {
      console.error(`  assign: linear issue assign ${issue.identifier}`)
    }
  })

const updateCommand = new Command()
  .description("Update issue")
  .example("Change priority", "linear issue update POL-5 --priority high")
  .example("Add a label", "linear issue update POL-5 --add-label bug")
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
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)

    // Resolve all async values before building input
    const description = options.description ?? (await readStdin())

    const assigneeId = options.assignee !== undefined
      ? (options.assignee === ""
        ? null
        : await resolveUser(client, options.assignee))
      : undefined

    const stateName = options.state ?? options.status
    let stateId: string | undefined
    if (stateName) {
      const state = await issue.state
      const team = await state?.team
      if (team?.id) {
        stateId = await resolveState(client, team.id, stateName)
      }
    }

    // Resolve labels (replace-all or delta)
    let labelIds: string[] | undefined
    const issueTeamId = async () => {
      const state = await issue.state
      const team = await state?.team
      return team?.id ?? ""
    }
    if (options.label?.length) {
      const tid = await issueTeamId()
      labelIds = await Promise.all(
        options.label.map((l: string) => resolveLabel(client, tid, l)),
      )
    } else if (options.addLabel?.length || options.removeLabel?.length) {
      const currentLabels = await issue.labels()
      const currentIds = currentLabels.nodes.map((l: { id: string }) => l.id)
      const tid = await issueTeamId()
      let ids = [...currentIds]
      if (options.addLabel?.length) {
        const addIds = await Promise.all(
          options.addLabel.map((l: string) => resolveLabel(client, tid, l)),
        )
        ids = [...new Set([...ids, ...addIds])]
      }
      if (options.removeLabel?.length) {
        const removeIds = await Promise.all(
          options.removeLabel.map((l: string) => resolveLabel(client, tid, l)),
        )
        ids = ids.filter((id) => !removeIds.includes(id))
      }
      labelIds = ids
    }

    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined
    const parentId = options.parent
      ? (await resolveIssue(client, options.parent, teamKey)).id
      : undefined

    await client.updateIssue(issue.id, {
      ...(options.title && { title: options.title }),
      ...(description !== undefined && { description }),
      ...(options.priority && { priority: resolvePriority(options.priority) }),
      ...(assigneeId !== undefined && { assigneeId }),
      ...(stateId && { stateId }),
      ...(labelIds && { labelIds }),
      ...(projectId && { projectId }),
      ...(parentId && { parentId }),
    })

    // Re-fetch and display updated issue
    const updated = await client.issue(issue.id)
    const updatedState = await updated.state
    const updatedAssignee = await updated.assignee
    const updatedDelegate = await updated.delegate

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: updated.identifier,
        entity: "issue",
        action: "update",
        status: "success",
        url: updated.url,
        metadata: {
          title: updated.title,
          state: updatedState?.name ?? "-",
          priority: priorityName(updated.priority),
          assignee: updatedAssignee?.name ?? null,
          delegate: updatedDelegate?.name ?? null,
        },
      }),
    })
  })

const deleteCommand = new Command()
  .description("Delete (archive) issue")
  .example("Delete an issue", "linear issue delete POL-5")
  .example("Delete multiple issues", "linear issue delete POL-1 POL-2 POL-3")
  .arguments("<ids...:string>")
  .example("Delete without confirmation", "linear issue delete POL-5 --yes")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client, noInput } = await getCommandContext(options)
    const teamKey = (options as { team?: string }).team

    const issues = await Promise.all(
      ids.map((id) => resolveIssue(client, id, teamKey)),
    )

    const label = issues.length === 1
      ? `${issues[0].identifier} "${issues[0].title}"`
      : `${issues.length} issues (${issues.map((issue) => issue.identifier).join(", ")})`
    const confirmed = await confirmDangerousAction({
      prompt: `Delete ${label}?`,
      skipConfirm: Boolean((options as { yes?: boolean }).yes) || noInput,
    })
    if (!confirmed) {
      renderMessage(format, "Canceled")
      return
    }

    await Promise.all(issues.map((issue) => client.archiveIssue(issue.id)))

    const payload = issues.map((issue) => ({
      id: issue.identifier,
      status: "success",
      url: issue.url,
      metadata: { title: issue.title },
    }))
    if (format === "json") {
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of issues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "delete",
          status: "success",
          url: issue.url,
          metadata: { title: issue.title },
        }),
      })
    }
  })

const commentListCommand = new Command()
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
  .example("Add a comment", "linear issue comment POL-5 'Looks good'")
  .example("List comments", "linear issue comment list POL-5")
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

const closeCommand = new Command()
  .alias("done").alias("finish").alias("complete").alias("resolve")
  .description("Close issue (set to completed state)")
  .example("Close an issue", "linear issue close POL-5")
  .example("Close multiple issues", "linear issue close POL-1 POL-2 POL-3")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const completedStateByTeam = new Map<string, { id: string; name: string }>()
    const closedIssues: Array<{
      identifier: string
      url: string
      state: string
    }> = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let completed = completedStateByTeam.get(team.id)
      if (!completed) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "completed")
        if (!stateNode) {
          throw new CliError(
            "no completed state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        completed = { id: stateNode.id, name: stateNode.name }
        completedStateByTeam.set(team.id, completed)
      }

      await client.updateIssue(issue.id, { stateId: completed.id })
      closedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: completed.name,
      })
    }

    if (format === "json") {
      const payload = closedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of closedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "close",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

const reopenCommand = new Command()
  .alias("open")
  .description("Reopen issue (set to unstarted state)")
  .example("Reopen an issue", "linear issue reopen POL-5")
  .example("Reopen multiple issues", "linear issue reopen POL-1 POL-2")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const unstartedStateByTeam = new Map<string, { id: string; name: string }>()
    const reopenedIssues: Array<{
      identifier: string
      url: string
      state: string
    }> = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let unstarted = unstartedStateByTeam.get(team.id)
      if (!unstarted) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "unstarted")
        if (!stateNode) {
          throw new CliError(
            "no unstarted state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        unstarted = { id: stateNode.id, name: stateNode.name }
        unstartedStateByTeam.set(team.id, unstarted)
      }

      await client.updateIssue(issue.id, { stateId: unstarted.id })
      reopenedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: unstarted.name,
      })
      if (format === "table") {
        console.error(`  assign: linear issue assign ${issue.identifier}`)
      }
    }

    if (format === "json") {
      const payload = reopenedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of reopenedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "reopen",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

const startCommand = new Command()
  .alias("begin")
  .description("Start issue (set to in-progress state)")
  .example("Start working on issue", "linear issue start POL-5")
  .example("Start multiple issues", "linear issue start POL-1 POL-2")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const startedStateByTeam = new Map<string, { id: string; name: string }>()
    const startedIssues: Array<{
      identifier: string
      url: string
      state: string
    }> = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let started = startedStateByTeam.get(team.id)
      if (!started) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "started")
        if (!stateNode) {
          throw new CliError(
            "no started state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        started = { id: stateNode.id, name: stateNode.name }
        startedStateByTeam.set(team.id, started)
      }

      await client.updateIssue(issue.id, { stateId: started.id })
      startedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: started.name,
      })
      if (format === "table") {
        console.error(`  close when done: linear issue close ${issue.identifier}`)
      }
    }

    if (format === "json") {
      const payload = startedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of startedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "start",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

const assignCommand = new Command()
  .description("Assign issue to user (defaults to me)")
  .example("Assign to me", "linear issue assign POL-5")
  .example("Assign to someone", "linear issue assign POL-5 'Jane Smith'")
  .example(
    "Assign multiple issues",
    "linear issue assign POL-1 POL-2 --user 'Jane Smith'",
  )
  .arguments("<targets...:string>")
  .option("-u, --user <user:string>", "Assignee (defaults to me)")
  .action(async (options, ...targets: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as { team?: string }).team

    const ids = [...targets]
    let assigneeName = (options as { user?: string }).user

    if (
      !assigneeName &&
      ids.length > 1 &&
      !/^[A-Za-z0-9]+-\d+$/.test(ids[ids.length - 1])
    ) {
      assigneeName = ids.pop()
    }

    if (ids.length === 0) {
      throw new CliError(
        "at least one issue id is required",
        4,
        "issue assign POL-1 [POL-2 ...] [--user <name>]",
      )
    }

    assigneeName = assigneeName ?? "me"
    const assigneeId = await resolveUser(client, assigneeName)

    const issues = await Promise.all(
      ids.map((id) => resolveIssue(client, id, teamKey)),
    )
    await Promise.all(issues.map((issue) => client.updateIssue(issue.id, { assigneeId })))

    // Resolve display name for confirmation
    let displayName: string
    if (assigneeName === "me") {
      const viewer = await client.viewer
      displayName = viewer.name
    } else {
      // Re-fetch to get the resolved name
      const updated = await client.issue(issues[0].id)
      const assignee = await updated.assignee
      displayName = assignee?.name ?? assigneeName
    }

    if (format === "json") {
      const payload = issues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { assignee: displayName },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of issues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "assign",
          status: "success",
          url: issue.url,
          metadata: { assignee: displayName },
        }),
      })
      if (format === "table") {
        console.error(`  start: linear issue start ${issue.identifier}`)
      }
    }
  })

const TERMINAL_SESSION_STATES = new Set(["complete", "error", "awaitingInput"])

/** Find the latest agent session for an issue. Returns null if none. */
async function getLatestSession(
  client: LinearClient,
  issueId: string,
) {
  const allSessions = await client.agentSessions()
  let latest = null
  for (const session of allSessions.nodes) {
    const sessionIssue = await session.issue
    if (sessionIssue?.id === issueId) {
      if (
        !latest ||
        new Date(session.createdAt) > new Date(latest.createdAt)
      ) {
        latest = session
      }
    }
  }
  return latest
}

const watchCommand = new Command()
  .description("Watch issue until agent session completes")
  .example(
    "Watch until done",
    "linear issue watch POL-7",
  )
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

    if (format === "table") {
      console.error(
        `Watching ${issue.identifier} for agent session completion...`,
      )
    }

    while (true) {
      const session = await getLatestSession(client, issue.id)

      if (session && TERMINAL_SESSION_STATES.has(session.status)) {
        const appUser = await session.appUser
        const activities = await session.activities()
        const responseActivity = activities.nodes.find(
          (a) => a.content.__typename === "AgentActivityResponseContent",
        )
        const summary = responseActivity?.content.__typename ===
            "AgentActivityResponseContent"
          ? responseActivity.content.body
          : null

        const result = {
          issue: issue.identifier,
          agent: appUser?.name ?? "Unknown",
          status: session.status,
          summary,
          // externalUrls is typed as Record<string, unknown> in SDK but is actually { url: string }[]
          externalUrl: session.externalLinks?.[0]?.url ??
            (session.externalUrls as unknown as { url?: string }[] | undefined)
              ?.[0]?.url ??
            null,
          elapsed: Math.round((Date.now() - start) / 1000),
        }

        if (format === "json") {
          renderJson(result)
        } else if (format === "compact") {
          console.log(
            `${result.issue}\t${result.agent}\t${result.status}\t${result.elapsed}s\t${
              result.summary?.replace(/\n/g, " ").slice(0, 200) ?? "-"
            }\t${result.externalUrl ?? "-"}`,
          )
        } else {
          console.log(
            `${result.issue}: ${result.agent} → ${result.status} (${result.elapsed}s)`,
          )
          if (result.summary) {
            console.log(
              renderMarkdown(result.summary, { indent: "  " }),
            )
          }
          if (result.externalUrl) {
            console.log(`  View task → ${result.externalUrl}`)
          }
        }

        // Exit code based on status
        if (session.status === "error") Deno.exit(1)
        if (session.status === "awaitingInput") Deno.exit(2)
        return // complete → exit 0
      }

      // Timeout check
      if (timeout > 0 && Date.now() - start > timeout) {
        const status = session ? session.status : "no session"
        const timeoutPayload = {
          issue: issue.identifier,
          status: "timeout",
          lastSessionStatus: status,
          elapsed: Math.round((Date.now() - start) / 1000),
        }
        if (format === "json") {
          renderJson(timeoutPayload)
        } else {
          console.error(
            `Timeout: ${issue.identifier} still ${status} after ${
              Math.round((Date.now() - start) / 1000)
            }s`,
          )
        }
        Deno.exit(124)
      }

      // Status update on stderr (doesn't pollute output)
      if (format === "table") {
        const status = session ? session.status : "waiting for session"
        console.error(
          `  ${status} (${Math.round((Date.now() - start) / 1000)}s)`,
        )
      }

      await new Promise((r) => setTimeout(r, interval))
    }
  })

export const issueCommand = new Command()
  .description("Manage issues")
  .alias("issues")
  .example("List issues", "linear issue list --team POL")
  .example("View issue", "linear issue view POL-5")
  .example("Close issue", "linear issue close POL-5")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("delete", deleteCommand)
  .command("comment", commentCommand)
  .command("branch", branchCommand)
  .command("close", closeCommand)
  .command("reopen", reopenCommand)
  .command("start", startCommand)
  .command("assign", assignCommand)
  .command("watch", watchCommand)
