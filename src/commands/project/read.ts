import { Command } from "@cliffy/command"
import { render, renderMessage } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import { resolveProjectByName } from "../../resolve.ts"
import { formatDate, relativeTime } from "../../time.ts"
import { getCommandContext } from "../_shared/context.ts"

export const listCommand = new Command()
  .description("List projects")
  .example("List active projects", "linear project list")
  .example("Include completed", "linear project list --include-completed")
  .example("Filter by lead", "linear project list --lead Alice")
  .example("Sort by progress", "linear project list --sort progress")
  .option(
    "-s, --state <state:string>",
    "Filter: planned, started, paused, completed, canceled",
    { collect: true },
  )
  .option("--include-completed", "Include completed/canceled")
  .option("--lead <name:string>", "Filter by lead name (substring match)")
  .option(
    "--sort <field:string>",
    "Sort: name, created, updated, target-date, progress",
    { default: "name" },
  )
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const projects = await client.projects()
    let items = projects.nodes

    if (options.state?.length) {
      items = items.filter((p) =>
        options.state!.includes(p.state?.toLowerCase() ?? "")
      )
    } else if (!options.includeCompleted) {
      items = items.filter((p) =>
        !["completed", "canceled"].includes(p.state?.toLowerCase() ?? "")
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

    if (options.lead) {
      const needle = options.lead.toLowerCase()
      rows = rows.filter((r) => r.lead.toLowerCase().includes(needle))
    }

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
      rows: payload.map((
        r,
      ) => [r.name, r.state, r.progress, r.lead, r.targetDate]),
    })
  })

export const viewCommand = new Command()
  .alias("show")
  .description("View project details")
  .example("View a project", "linear project view 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const previewLimit = 10

    const project = await resolveProjectByName(client, name)
    const lead = await project.lead
    const teams = await project.teams()
    const issues = await project.issues({ first: previewLimit + 1 })
    const hasMoreIssues = issues.nodes.length > previewLimit
    const previewIssues = hasMoreIssues
      ? issues.nodes.slice(0, previewLimit)
      : issues.nodes

    const issueRows = await Promise.all(
      previewIssues.map(async (issue) => {
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

    const totalCount =
      ((project as unknown as { issueCount?: number }).issueCount) ??
        issueRows.length
    const completedCount = Math.round(
      (project.progress ?? 0) * (totalCount || 1),
    )
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
      issuePreviewLimit: previewLimit,
      issuePreviewHasMore: hasMoreIssues,
      issueTotalCount: totalCount,
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
        `issue_preview\t${payload.issuePreviewCount}/${payload.issueTotalCount}${
          payload.issuePreviewHasMore ? "+" : ""
        }`,
        `url\t${payload.url}`,
      ]
      renderMessage(format, lines.join("\n"))
      return
    }

    render("table", {
      title: payload.name,
      fields: [
        { label: "Description", value: payload.description ?? "-" },
        { label: "State", value: payload.state },
        { label: "Progress", value: `${payload.progressSummary} issues` },
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
      const issueLines = payload.issues.map((r) =>
        `  ${r.identifier}  ${r.state}  ${r.assignee}  ${r.title}    ${
          relativeTime(r.updatedAt)
        }`
      )
      const moreSuffix = payload.issuePreviewHasMore
        ? `\n  ...and more (${
          payload.issueTotalCount - payload.issuePreviewCount
        } additional)`
        : ""
      renderMessage(
        format,
        `\nRecent Issues:\n${issueLines.join("\n")}${moreSuffix}`,
      )
    }
  })

export const labelsCommand = new Command()
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
