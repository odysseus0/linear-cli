import { Command } from "@cliffy/command"
import { type LinearClient, ProjectUpdateHealthType } from "@linear/sdk"
import { CliError } from "../errors.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import {
  readStdin,
  resolveIssue,
  resolveProjectByName,
  resolveUser,
} from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"
import { confirmDangerousAction } from "./_shared/confirm.ts"
import { getCommandContext } from "./_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "./_shared/mutation_output.ts"

const HEALTH_MAP: Record<string, ProjectUpdateHealthType> = {
  ontrack: ProjectUpdateHealthType.OnTrack,
  atrisk: ProjectUpdateHealthType.AtRisk,
  offtrack: ProjectUpdateHealthType.OffTrack,
}

const listCommand = new Command()
  .description("List projects")
  .example("List active projects", "linear project list")
  .example("Include completed", "linear project list --include-completed")
  .example("Filter by lead", "linear project list --lead Alice")
  .example("Sort by progress", "linear project list --sort progress")
  .option(
    "-s, --state <state:string>",
    "Filter: planned, started, paused, completed, canceled",
    {
      collect: true,
    },
  )
  .option("--include-completed", "Include completed/canceled")
  .option("--lead <name:string>", "Filter by lead name (substring match)")
  .option(
    "--sort <field:string>",
    "Sort: name, created, updated, target-date, progress",
    {
      default: "name",
    },
  )
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const projects = await client.projects()
    let items = projects.nodes

    // Filter by state
    if (options.state?.length) {
      items = items.filter((p) =>
        options.state!.includes(p.state?.toLowerCase() ?? "")
      )
    } else if (!options.includeCompleted) {
      items = items.filter(
        (p) =>
          !["completed", "canceled"].includes(p.state?.toLowerCase() ?? ""),
      )
    }

    let rows = await Promise.all(
      items.map(async (p) => {
        const lead = await p.lead
        return {
          name: p.name,
          state: p.state ?? "-",
          progressNum: p.progress ?? 0,
          progress: `${Math.round((p.progress ?? 0) * 100)}%`,
          lead: lead?.name ?? "-",
          targetDate: p.targetDate ?? "-",
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          url: p.url,
        }
      }),
    )

    // Filter by lead (substring, case-insensitive)
    if (options.lead) {
      const needle = options.lead.toLowerCase()
      rows = rows.filter((r) => r.lead.toLowerCase().includes(needle))
    }

    // Sort
    const sortField = options.sort ?? "name"
    rows.sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.name.localeCompare(b.name)
        case "created":
          return new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        case "updated":
          return new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime()
        case "target-date": {
          // Nulls ("-") sort last
          if (a.targetDate === "-" && b.targetDate === "-") return 0
          if (a.targetDate === "-") return 1
          if (b.targetDate === "-") return -1
          return a.targetDate.localeCompare(b.targetDate)
        }
        case "progress":
          return b.progressNum - a.progressNum
        default:
          return 0
      }
    })

    const payload = rows.map((r) => ({
      name: r.name,
      state: r.state,
      progress: r.progress,
      lead: r.lead,
      targetDate: r.targetDate,
      url: r.url,
    }))

    if (format === "json") {
      renderJson(payload)
      return
    }

    render(format, {
      headers: ["Name", "State", "Progress", "Lead", "Target"],
      rows: payload.map((r) => [
        r.name,
        r.state,
        r.progress,
        r.lead,
        r.targetDate,
      ]),
    })
  })

const viewCommand = new Command()
  .alias("show")
  .description("View project details")
  .example("View a project", "linear project view 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)

    const lead = await project.lead
    const teams = await project.teams()
    const issues = await project.issues({ first: 10 })

    const issueRows = await Promise.all(
      issues.nodes.map(async (issue) => {
        const state = await issue.state
        const assignee = await issue.assignee
        return {
          identifier: issue.identifier,
          state: state?.name ?? "-",
          assignee: assignee?.name ?? "-",
          title: issue.title,
          updatedAt: issue.updatedAt,
        }
      }),
    )

    const completedCount = Math.round(
      (project.progress ?? 0) * (issues.nodes.length || 1),
    )
    const totalCount = issues.nodes.length
    const payload = {
      name: project.name,
      description: project.description ?? null,
      state: project.state ?? "-",
      progressPercent: Math.round((project.progress ?? 0) * 100),
      progressSummary: `${
        Math.round((project.progress ?? 0) * 100)
      }% (${completedCount}/${totalCount})`,
      lead: lead?.name ?? null,
      targetDate: project.targetDate ?? null,
      teams: teams.nodes.map((t) => t.key),
      url: project.url,
      createdAt: project.createdAt,
      issues: issueRows,
      issuePreviewCount: issueRows.length,
      issuePreviewLimit: 10,
    }

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "compact") {
      const lines = [
        `name\t${payload.name}`,
        `description\t${payload.description ?? "-"}`,
        `state\t${payload.state}`,
        `progress\t${payload.progressSummary}`,
        `lead\t${payload.lead ?? "-"}`,
        `target\t${payload.targetDate ?? "-"}`,
        `teams\t${payload.teams.join(", ")}`,
        `url\t${payload.url}`,
      ]
      console.log(lines.join("\n"))
      return
    }

    render("table", {
      title: payload.name,
      fields: [
        { label: "Description", value: payload.description ?? "-" },
        { label: "State", value: payload.state },
        {
          label: "Progress",
          value: `${payload.progressSummary} issues`,
        },
        { label: "Lead", value: payload.lead ?? "-" },
        { label: "Target", value: payload.targetDate ?? "-" },
        { label: "Teams", value: payload.teams.join(", ") },
        {
          label: "Created",
          value: `${formatDate(payload.createdAt)} (${
            relativeTime(payload.createdAt)
          })`,
        },
        { label: "URL", value: payload.url },
      ],
    })

    if (payload.issues.length > 0) {
      console.log("\nRecent Issues:")
      for (const r of payload.issues) {
        console.log(
          `  ${r.identifier}  ${r.state}  ${r.assignee}  ${r.title}    ${
            relativeTime(r.updatedAt)
          }`,
        )
      }
    }
  })

const createCommand = new Command()
  .description("Create project")
  .example(
    "Create a project",
    "linear project create --name 'Q1 Roadmap' --target-date 2026-03-31",
  )
  .option("--name <name:string>", "Project name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--lead <name:string>", "Project lead")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const description = options.description ?? await readStdin()
    const leadId = options.lead
      ? await resolveUser(client, options.lead)
      : undefined

    let teamIds: string[] = []
    const teamKey = (options as unknown as { team?: string }).team
    if (teamKey) {
      const teams = await client.teams()
      const team = teams.nodes.find(
        (t) => t.key.toLowerCase() === teamKey.toLowerCase(),
      )
      if (team) teamIds = [team.id]
    }

    const payload = await client.createProject({
      name: options.name,
      teamIds,
      ...(description && { description }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(leadId && { leadId }),
    })
    const project = await payload.project

    if (!project) {
      throw new CliError("failed to create project", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "create",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
    if (format === "table") {
      console.error(
        `  add issues: linear project add-issue '${project.name}' <issue-id>`,
      )
    }
  })

const updateCommand = new Command()
  .description("Update project")
  .example(
    "Update target date",
    "linear project update 'My Project' --target-date 2026-04-01",
  )
  .arguments("<name:string>")
  .option("--name <name:string>", "New name")
  .option("-d, --description <desc:string>", "New description")
  .option("--lead <name:string>", "New lead (empty to unassign)")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--start-date <date:string>", "Start date (YYYY-MM-DD)")
  .option("--color <color:string>", "Project color hex")
  .option("--status <status:string>", "Redirect: use project post instead", {
    hidden: true,
  })
  .action(async (options, projectName: string) => {
    // Intercept --status: agents confuse "project update --status" with project posts
    if ((options as { status?: string }).status) {
      console.error(
        `error: project update does not have a --status flag`,
      )
      console.error(
        `  try: linear project post "${projectName}" --body <text> --health <onTrack|atRisk|offTrack>`,
      )
      Deno.exit(4)
    }

    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, projectName)

    const description = options.description ?? (await readStdin())
    const leadId = options.lead !== undefined
      ? (options.lead === "" ? null : await resolveUser(client, options.lead))
      : undefined

    const payload = await client.updateProject(project.id, {
      ...(options.name && { name: options.name }),
      ...(description !== undefined && { description }),
      ...(leadId !== undefined && { leadId }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(options.startDate && { startDate: options.startDate }),
      ...(options.color && { color: options.color }),
    })
    const updated = await payload.project

    if (!updated) {
      throw new CliError("failed to update project", 1)
    }

    const lead = await updated.lead

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: updated.id,
        entity: "project",
        action: "update",
        status: "success",
        url: updated.url,
        metadata: {
          name: updated.name,
          state: updated.state ?? "-",
          progress: `${Math.round((updated.progress ?? 0) * 100)}%`,
          lead: lead?.name ?? null,
          targetDate: updated.targetDate ?? null,
        },
      }),
    })
  })

// --- Milestone subcommands ---

const milestoneListCommand = new Command()
  .description("List milestones for a project")
  .example("List milestones", "linear project milestone list 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)
    const milestones = await project.projectMilestones()

    const payload = milestones.nodes.map((m) => ({
      name: m.name,
      status: String(m.status ?? "-"),
      targetDate: m.targetDate ?? "-",
      progress: `${Math.round((m.progress ?? 0) * 100)}%`,
      description: m.description ?? "-",
    }))

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Name", "Status", "Target", "Progress", "Description"],
        rows: payload.map((r) => [
          r.name,
          r.status,
          r.targetDate,
          r.progress,
          r.description.length > 50
            ? r.description.slice(0, 47) + "..."
            : r.description,
        ]),
      })
    } else {
      render("compact", {
        headers: ["Name", "Status", "Target", "Progress"],
        rows: payload.map((r) => [
          r.name,
          r.status,
          r.targetDate,
          r.progress,
        ]),
      })
    }
  })

const milestoneCreateCommand = new Command()
  .alias("add")
  .description("Create milestone on a project")
  .example(
    "Add milestone",
    "linear project milestone create 'Beta launch' --project 'My Project' --target-date 2026-03-15",
  )
  .arguments("<name:string>")
  .option("--project <project:string>", "Project name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--date <date:string>", "Alias for --target-date", { hidden: true })
  .action(async (options, milestoneName: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, options.project)

    const targetDate = options.targetDate ??
      (options as { date?: string }).date

    const payload = await client.createProjectMilestone({
      projectId: project.id,
      name: milestoneName,
      ...(options.description && { description: options.description }),
      ...(targetDate && { targetDate }),
    })
    const milestone = await payload.projectMilestone

    if (!milestone) {
      throw new CliError("failed to create milestone", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: milestone.id,
        entity: "projectMilestone",
        action: "create",
        status: "success",
        metadata: {
          name: milestone.name,
          targetDate: milestone.targetDate ?? null,
          description: milestone.description ?? null,
        },
      }),
    })
  })

const milestoneCommand = new Command()
  .description("Manage project milestones")
  .command("list", milestoneListCommand)
  .command("create", milestoneCreateCommand)

// --- Post (project update) command ---

const postCommand = new Command()
  .description("Create project update (status post)")
  .example(
    "Post status update",
    "linear project post 'My Project' --body 'On track' --health onTrack",
  )
  .arguments("<name:string>")
  .option("--body <text:string>", "Update body in markdown")
  .option(
    "--health <health:string>",
    "Health: onTrack, atRisk, offTrack",
  )
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)

    const body = options.body ?? (await readStdin())

    let health: ProjectUpdateHealthType | undefined
    if (options.health) {
      health = HEALTH_MAP[options.health.toLowerCase()]
      if (!health) {
        throw new CliError(
          `invalid health "${options.health}"`,
          4,
          "try: onTrack, atRisk, offTrack",
        )
      }
    }

    const payload = await client.createProjectUpdate({
      projectId: project.id,
      ...(body && { body }),
      ...(health && { health }),
    })
    const update = await payload.projectUpdate

    if (!update) {
      throw new CliError("failed to create project update", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: update.id,
        entity: "projectUpdate",
        action: "create",
        status: "success",
        url: update.url,
        metadata: {
          project: project.name,
          health: update.health ?? null,
          createdAt: update.createdAt,
        },
      }),
    })
  })

// --- Labels command ---

const labelsCommand = new Command()
  .description("List labels for a project")
  .example("List project labels", "linear project labels 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)
    const labels = await project.labels()

    const payload = labels.nodes.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description ?? "-",
      group: l.isGroup ? "yes" : "no",
    }))

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Name", "Color", "Group", "Description"],
        rows: payload.map((r) => [
          r.name,
          r.color,
          r.group,
          r.description.length > 50
            ? r.description.slice(0, 47) + "..."
            : r.description,
        ]),
      })
    } else {
      render("compact", {
        headers: ["Name", "Color", "Description"],
        rows: payload.map((r) => [r.name, r.color, r.description]),
      })
    }
  })

const deleteCommand = new Command()
  .description("Delete project")
  .example("Delete a project", "linear project delete 'My Project'")
  .example(
    "Delete without confirmation",
    "linear project delete 'My Project' --yes",
  )
  .arguments("<name:string>")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options, name: string) => {
    const { format, client, noInput } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)

    const confirmed = await confirmDangerousAction({
      prompt: `Delete project "${project.name}"?`,
      skipConfirm: Boolean((options as { yes?: boolean }).yes) || noInput,
    })
    if (!confirmed) {
      renderMessage(format, "Canceled")
      return
    }

    await client.deleteProject(project.id)
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "delete",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

// --- Porcelain: state transitions ---

/** Find project status ID by type (started, paused, completed, canceled). */
async function resolveProjectStatusId(
  client: LinearClient,
  statusType: string,
): Promise<string> {
  const statuses = await client.projectStatuses()
  const match = statuses.nodes.find(
    (s) => s.type?.toLowerCase() === statusType.toLowerCase(),
  )
  if (!match) {
    throw new CliError(
      `no project status of type "${statusType}" found`,
      1,
      "check project status configuration in Linear settings",
    )
  }
  return match.id
}

const startCommand = new Command()
  .description("Start project (set state to started)")
  .example("Start a project", "linear project start 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "started")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "start",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
    if (format === "table") {
      console.error(
        `  post update: linear project post '${name}' --body '<text>'`,
      )
    }
  })

const pauseCommand = new Command()
  .description("Pause project (set state to paused)")
  .example("Pause a project", "linear project pause 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "paused")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "pause",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

const completeCommand = new Command()
  .description("Complete project (set state to completed)")
  .example("Complete a project", "linear project complete 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "completed")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "complete",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

const cancelCommand = new Command()
  .description("Cancel project (set state to canceled)")
  .example("Cancel a project", "linear project cancel 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "canceled")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "cancel",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

// --- Porcelain: cross-entity actions ---

const addIssueCommand = new Command()
  .description("Add issue to project")
  .example(
    "Add issue to project",
    "linear project add-issue 'My Project' POL-5",
  )
  .arguments("<project:string> <issue:string>")
  .action(async (options, projectName: string, issueId: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const project = await resolveProjectByName(client, projectName)
    const issue = await resolveIssue(client, issueId, teamKey)

    await client.updateIssue(issue.id, { projectId: project.id })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: issue.identifier,
        entity: "issue",
        action: "moveToProject",
        status: "success",
        url: issue.url,
        metadata: { project: project.name },
      }),
    })
  })

export const projectCommand = new Command()
  .description("Manage projects")
  .alias("projects")
  .example("List projects", "linear project list")
  .example("View project", "linear project view 'My Project'")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("milestone", milestoneCommand)
  .command("post", postCommand)
  .command("labels", labelsCommand)
  .command("start", startCommand)
  .command("pause", pauseCommand)
  .command("complete", completeCommand)
  .command("cancel", cancelCommand)
  .command("delete", deleteCommand)
  .command("add-issue", addIssueCommand)
