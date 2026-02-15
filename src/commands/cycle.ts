import { Command } from "@cliffy/command"
import { CliError } from "../errors.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { resolveTeam } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"
import { getCommandContext } from "./_shared/context.ts"

const listCommand = new Command()
  .description("List cycles")
  .example("List team cycles", "linear cycle list --team POL")
  .action(async (options) => {
    const { format, client, teamKey } = await getCommandContext(options, {
      requireTeam: true,
    })

    const team = await resolveTeam(client, teamKey)

    const cycles = await team.cycles()
    const items = cycles.nodes.sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0),
    )
    const payload = items.map((c) => ({
      number: c.number,
      name: c.name ?? `Sprint ${c.number}`,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      progress: Math.round((c.progress ?? 0) * 100),
    }))

    if (format === "json") {
      renderJson(payload)
      return
    }

    render(format, {
      headers: ["#", "Name", "Starts", "Ends", "Progress"],
      rows: payload.map((c) => [
        String(c.number ?? "-"),
        c.name ?? "-",
        c.startsAt ? formatDate(c.startsAt) : "-",
        c.endsAt ? formatDate(c.endsAt) : "-",
        `${c.progress}%`,
      ]),
    })
  })

const viewCommand = new Command()
  .description("View cycle details")
  .example("View a cycle", "linear cycle view 3 --team POL")
  .arguments("<number:integer>")
  .action(async (options, number: number) => {
    const { format, client, teamKey } = await getCommandContext(options, {
      requireTeam: true,
    })

    const team = await resolveTeam(client, teamKey)

    const cycles = await team.cycles()
    const cycle = cycles.nodes.find((c) => c.number === number)
    if (!cycle) {
      throw new CliError(
        `cycle #${number} not found`,
        3,
        "list cycles with: linear cycle list --team <key>",
      )
    }

    const issues = await cycle.issues()
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
      (cycle.progress ?? 0) * issues.nodes.length,
    )
    const totalCount = issues.nodes.length
    const cycleName = cycle.name ?? `Sprint ${cycle.number}`
    const payload = {
      number: cycle.number,
      name: cycleName,
      startsAt: cycle.startsAt ?? null,
      endsAt: cycle.endsAt ?? null,
      progressPercent: Math.round((cycle.progress ?? 0) * 100),
      progressSummary: `${
        Math.round((cycle.progress ?? 0) * 100)
      }% (${completedCount}/${totalCount})`,
      issues: issueRows,
    }

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "compact") {
      const lines = [
        `number\t${payload.number}`,
        `name\t${payload.name}`,
        `starts\t${payload.startsAt ? formatDate(payload.startsAt) : "-"}`,
        `ends\t${payload.endsAt ? formatDate(payload.endsAt) : "-"}`,
        `progress\t${payload.progressSummary}`,
      ]
      renderMessage(format, lines.join("\n"))
      return
    }

    render("table", {
      title: `${payload.name} (#${payload.number})`,
      fields: [
        {
          label: "Period",
          value: `${payload.startsAt ? formatDate(payload.startsAt) : "?"} → ${
            payload.endsAt ? formatDate(payload.endsAt) : "?"
          }`,
        },
        {
          label: "Progress",
          value: `${payload.progressSummary} issues`,
        },
      ],
    })

    if (payload.issues.length > 0) {
      const issueLines = payload.issues.map((r) =>
        `  ${r.identifier}  ${r.state}  ${r.assignee}  ${r.title}    ${
          relativeTime(r.updatedAt)
        }`
      )
      renderMessage(format, `\nIssues:\n${issueLines.join("\n")}`)
    }
  })

export const cycleCommand = new Command()
  .description("Manage cycles")
  .command("list", listCommand)
  .command("view", viewCommand)
