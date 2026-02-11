import { Command } from "@cliffy/command"
import { ProjectUpdateHealthType } from "@linear/sdk"
import { createClient } from "../client.ts"
import { CliError } from "../errors.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import {
  readStdin,
  resolveIssue,
  resolveProjectByName,
  resolveUser,
} from "../resolve.ts"
import type { GlobalOptions } from "../types.ts"
import { formatDate, relativeTime } from "../time.ts"

const HEALTH_MAP: Record<string, ProjectUpdateHealthType> = {
  ontrack: ProjectUpdateHealthType.OnTrack,
  atrisk: ProjectUpdateHealthType.AtRisk,
  offtrack: ProjectUpdateHealthType.OffTrack,
}

async function buildProjectJson(
  // deno-lint-ignore no-explicit-any
  project: any,
) {
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

  return {
    name: project.name,
    description: project.description ?? null,
    state: project.state ?? "-",
    progress: `${Math.round((project.progress ?? 0) * 100)}%`,
    lead: lead?.name ?? null,
    targetDate: project.targetDate ?? null,
    teams: teams.nodes.map((t) => t.key),
    url: project.url,
    createdAt: project.createdAt,
    issues: issueRows,
  }
}

const listCommand = new Command()
  .description("List projects")
  .example("List active projects", "linear project list")
  .example("Include completed", "linear project list --include-completed")
  .option(
    "-s, --state <state:string>",
    "Filter: planned, started, paused, completed, canceled",
    {
      collect: true,
    },
  )
  .option("--include-completed", "Include completed/canceled")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

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

    const rows = await Promise.all(
      items.map(async (p) => {
        const lead = await p.lead
        return {
          name: p.name,
          state: p.state ?? "-",
          progress: `${Math.round((p.progress ?? 0) * 100)}%`,
          lead: lead?.name ?? "-",
          targetDate: p.targetDate ?? "-",
          url: p.url,
        }
      }),
    )

    if (format === "json") {
      renderJson(rows)
      return
    }

    render(format, {
      headers: ["Name", "State", "Progress", "Lead", "Target"],
      rows: rows.map((r) => [
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

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

    if (format === "json") {
      renderJson(await buildProjectJson(project))
      return
    }

    if (format === "compact") {
      const lines = [
        `name\t${project.name}`,
        `description\t${project.description ?? "-"}`,
        `state\t${project.state ?? "-"}`,
        `progress\t${
          Math.round((project.progress ?? 0) * 100)
        }% (${completedCount}/${totalCount})`,
        `lead\t${lead?.name ?? "-"}`,
        `target\t${project.targetDate ?? "-"}`,
        `teams\t${teams.nodes.map((t) => t.key).join(", ")}`,
        `url\t${project.url}`,
      ]
      console.log(lines.join("\n"))
      return
    }

    render("table", {
      title: project.name,
      fields: [
        { label: "Description", value: project.description ?? "-" },
        { label: "State", value: project.state ?? "-" },
        {
          label: "Progress",
          value: `${
            Math.round((project.progress ?? 0) * 100)
          }% (${completedCount}/${totalCount} issues)`,
        },
        { label: "Lead", value: lead?.name ?? "-" },
        { label: "Target", value: project.targetDate ?? "-" },
        { label: "Teams", value: teams.nodes.map((t) => t.key).join(", ") },
        {
          label: "Created",
          value: `${formatDate(project.createdAt)} (${
            relativeTime(project.createdAt)
          })`,
        },
        { label: "URL", value: project.url },
      ],
    })

    if (issueRows.length > 0) {
      console.log("\nRecent Issues:")
      for (const r of issueRows) {
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const description = options.description ?? await readStdin()
    const leadId = options.lead
      ? await resolveUser(client, options.lead)
      : undefined

    let teamIds: string[] = []
    const teamKey = (options as { team?: string }).team
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
      throw new Error("failed to create project")
    }

    if (format === "json") {
      renderJson({ name: project.name, url: project.url })
      return
    }

    renderMessage(
      format,
      `Created project: ${project.name}\n${project.url}`,
    )
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

    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

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
      throw new Error("failed to update project")
    }

    if (format === "json") {
      renderJson(await buildProjectJson(updated))
      return
    }

    renderMessage(
      format,
      `${updated.name} updated
${updated.url}`,
    )
  })

// --- Milestone subcommands ---

const milestoneListCommand = new Command()
  .description("List milestones for a project")
  .example("List milestones", "linear project milestone list 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const project = await resolveProjectByName(client, name)
    const milestones = await project.projectMilestones()

    const rows = milestones.nodes.map((m) => ({
      name: m.name,
      status: String(m.status ?? "-"),
      targetDate: m.targetDate ?? "-",
      progress: `${Math.round((m.progress ?? 0) * 100)}%`,
      description: m.description ?? "-",
    }))

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Name", "Status", "Target", "Progress", "Description"],
        rows: rows.map((r) => [
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
        rows: rows.map((r) => [
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

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
      throw new Error("failed to create milestone")
    }

    if (format === "json") {
      renderJson({
        name: milestone.name,
        targetDate: milestone.targetDate ?? null,
        description: milestone.description ?? null,
      })
      return
    }

    renderMessage(
      format,
      `Created milestone: ${milestone.name}${
        milestone.targetDate ? ` (target: ${milestone.targetDate})` : ""
      }`,
    )
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

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
      throw new Error("failed to create project update")
    }

    if (format === "json") {
      renderJson({
        url: update.url,
        health: update.health ?? null,
        createdAt: update.createdAt,
      })
      return
    }

    renderMessage(
      format,
      `Posted update for ${project.name}${
        update.health ? ` [${update.health}]` : ""
      }\n${update.url}`,
    )
  })

// --- Labels command ---

const labelsCommand = new Command()
  .description("List labels for a project")
  .example("List project labels", "linear project labels 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const project = await resolveProjectByName(client, name)
    const labels = await project.labels()

    const rows = labels.nodes.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description ?? "-",
      group: l.isGroup ? "yes" : "no",
    }))

    if (format === "json") {
      renderJson(rows)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Name", "Color", "Group", "Description"],
        rows: rows.map((r) => [
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
        rows: rows.map((r) => [r.name, r.color, r.description]),
      })
    }
  })

// --- Porcelain: state transitions ---

/** Find project status ID by type (started, paused, completed, canceled). */
async function resolveProjectStatusId(
  client: ReturnType<typeof createClient>,
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "started")
    await client.updateProject(project.id, { statusId })
    const updated = await client.project(project.id)

    if (format === "json") {
      renderJson(await buildProjectJson(updated))
      return
    }

    renderMessage(
      format,
      `${updated.name} started
${updated.url}`,
    )
  })

const pauseCommand = new Command()
  .description("Pause project (set state to paused)")
  .example("Pause a project", "linear project pause 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "paused")
    await client.updateProject(project.id, { statusId })
    const updated = await client.project(project.id)

    if (format === "json") {
      renderJson(await buildProjectJson(updated))
      return
    }

    renderMessage(
      format,
      `${updated.name} paused
${updated.url}`,
    )
  })

const completeCommand = new Command()
  .description("Complete project (set state to completed)")
  .example("Complete a project", "linear project complete 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "completed")
    await client.updateProject(project.id, { statusId })
    const updated = await client.project(project.id)

    if (format === "json") {
      renderJson(await buildProjectJson(updated))
      return
    }

    renderMessage(
      format,
      `${updated.name} completed
${updated.url}`,
    )
  })

const cancelCommand = new Command()
  .description("Cancel project (set state to canceled)")
  .example("Cancel a project", "linear project cancel 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "canceled")
    await client.updateProject(project.id, { statusId })
    const updated = await client.project(project.id)

    if (format === "json") {
      renderJson(await buildProjectJson(updated))
      return
    }

    renderMessage(
      format,
      `${updated.name} canceled
${updated.url}`,
    )
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = (options as unknown as GlobalOptions).team

    const project = await resolveProjectByName(client, projectName)
    const issue = await resolveIssue(client, issueId, teamKey)

    await client.updateIssue(issue.id, { projectId: project.id })

    if (format === "json") {
      const updatedProject = await client.project(project.id)
      renderJson(await buildProjectJson(updatedProject))
      return
    }

    renderMessage(
      format,
      `${issue.identifier} added to ${project.name}
${project.url}`,
    )
  })

export const projectCommand = new Command()
  .description("Manage projects")
  .alias("projects")
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
  .command("add-issue", addIssueCommand)
