import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { readStdin, resolveUser } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"

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
  .description("View project details")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    // Find project by name
    const projects = await client.projects()
    const all = projects.nodes
    let project = all.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    )
    if (!project) {
      const partial = all.filter(
        (p) => p.name.toLowerCase().includes(name.toLowerCase()),
      )
      if (partial.length === 1) project = partial[0]
    }
    if (!project) {
      throw new Error(`project not found: "${name}"`)
    }

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

export const projectCommand = new Command()
  .description("Manage projects")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
