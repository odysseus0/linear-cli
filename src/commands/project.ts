import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { CliError } from "../errors.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import {
  readStdin,
  resolveProjectByName,
  resolveUser,
} from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"

const HEALTH_MAP: Record<string, string> = {
  ontrack: "onTrack",
  atrisk: "atRisk",
  offtrack: "offTrack",
}

const listCommand = new Command()
  .description("List projects")
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
      renderJson({
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
      })
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
  .option("--name <name:string>", "Project name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--lead <name:string>", "Project lead")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const description = options.description ?? await readStdin()

    // deno-lint-ignore no-explicit-any
    const input: any = {
      name: options.name,
    }

    if (description) input.description = description
    if (options.targetDate) input.targetDate = options.targetDate

    if (options.lead) {
      input.leadId = await resolveUser(client, options.lead)
    }

    // Add team if specified
    if ((options as { team?: string }).team) {
      const teams = await client.teams()
      const team = teams.nodes.find(
        (t) =>
          t.key.toLowerCase() ===
            (options as { team?: string }).team!.toLowerCase(),
      )
      if (team) {
        input.teamIds = [team.id]
      }
    }

    const payload = await client.createProject(input)
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
  })

const updateCommand = new Command()
  .description("Update project")
  .arguments("<name:string>")
  .option("--name <name:string>", "New name")
  .option("-d, --description <desc:string>", "New description")
  .option("--lead <name:string>", "New lead (empty to unassign)")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--start-date <date:string>", "Start date (YYYY-MM-DD)")
  .option("--color <color:string>", "Project color hex")
  .action(async (options, projectName: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const project = await resolveProjectByName(client, projectName)

    // deno-lint-ignore no-explicit-any
    const input: any = {}

    if (options.name) input.name = options.name

    // Description: flag -> stdin
    const description = options.description ?? (await readStdin())
    if (description !== undefined) input.description = description

    if (options.lead !== undefined) {
      if (options.lead === "") {
        input.leadId = null
      } else {
        input.leadId = await resolveUser(client, options.lead)
      }
    }

    if (options.targetDate) input.targetDate = options.targetDate
    if (options.startDate) input.startDate = options.startDate
    if (options.color) input.color = options.color

    const payload = await client.updateProject(project.id, input)
    const updated = await payload.project

    if (!updated) {
      throw new Error("failed to update project")
    }

    const lead = await updated.lead

    if (format === "json") {
      renderJson({
        name: updated.name,
        state: updated.state ?? "-",
        lead: lead?.name ?? null,
        targetDate: updated.targetDate ?? null,
        url: updated.url,
      })
      return
    }

    render(format === "table" ? "table" : "compact", {
      title: updated.name,
      fields: [
        { label: "State", value: updated.state ?? "-" },
        {
          label: "Progress",
          value: `${Math.round((updated.progress ?? 0) * 100)}%`,
        },
        { label: "Lead", value: lead?.name ?? "-" },
        { label: "Target", value: updated.targetDate ?? "-" },
        { label: "URL", value: updated.url },
      ],
    })
  })

// --- Milestone subcommands ---

const milestoneListCommand = new Command()
  .description("List milestones for a project")
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
  .arguments("<name:string>")
  .option("--name <name:string>", "Milestone name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--date <date:string>", "Alias for --target-date", { hidden: true })
  .action(async (options, projectName: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const project = await resolveProjectByName(client, projectName)

    // deno-lint-ignore no-explicit-any
    const input: any = {
      projectId: project.id,
      name: options.name,
    }

    if (options.description) input.description = options.description
    const targetDate = options.targetDate ??
      (options as { date?: string }).date
    if (targetDate) input.targetDate = targetDate

    const payload = await client.createProjectMilestone(input)
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

    // deno-lint-ignore no-explicit-any
    const input: any = {
      projectId: project.id,
    }

    if (body) input.body = body

    if (options.health) {
      const normalized = HEALTH_MAP[options.health.toLowerCase()]
      if (!normalized) {
        throw new CliError(
          `invalid health "${options.health}"`,
          4,
          "try: onTrack, atRisk, offTrack",
        )
      }
      input.health = normalized
    }

    const payload = await client.createProjectUpdate(input)
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
