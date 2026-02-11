import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { requireTeam } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"

const listCommand = new Command()
  .description("List cycles")
  .example("List team cycles", "linear cycle list --team POL")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = requireTeam(options)

    const teams = await client.teams()
    const team = teams.nodes.find(
      (t) => t.key.toLowerCase() === teamKey.toLowerCase(),
    )
    if (!team) {
      throw new Error(`team not found: "${teamKey}"`)
    }

    const cycles = await team.cycles()
    const items = cycles.nodes.sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0),
    )

    if (format === "json") {
      renderJson(
        items.map((c) => ({
          number: c.number,
          name: c.name ?? `Sprint ${c.number}`,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          progress: Math.round((c.progress ?? 0) * 100),
        })),
      )
      return
    }

    render(format, {
      headers: ["#", "Name", "Starts", "Ends", "Progress"],
      rows: items.map((c) => [
        String(c.number ?? "-"),
        c.name ?? `Sprint ${c.number}`,
        c.startsAt ? formatDate(c.startsAt) : "-",
        c.endsAt ? formatDate(c.endsAt) : "-",
        `${Math.round((c.progress ?? 0) * 100)}%`,
      ]),
    })
  })

const viewCommand = new Command()
  .description("View cycle details")
  .example("View a cycle", "linear cycle view 3 --team POL")
  .arguments("<number:integer>")
  .action(async (options, number: number) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)
    const teamKey = requireTeam(options)

    const teams = await client.teams()
    const team = teams.nodes.find(
      (t) => t.key.toLowerCase() === teamKey.toLowerCase(),
    )
    if (!team) {
      throw new Error(`team not found: "${teamKey}"`)
    }

    const cycles = await team.cycles()
    const cycle = cycles.nodes.find((c) => c.number === number)
    if (!cycle) {
      throw new Error(`cycle #${number} not found`)
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

    if (format === "json") {
      renderJson({
        number: cycle.number,
        name: cycleName,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        progress: Math.round((cycle.progress ?? 0) * 100),
        issues: issueRows,
      })
      return
    }

    if (format === "compact") {
      const lines = [
        `number\t${cycle.number}`,
        `name\t${cycleName}`,
        `starts\t${cycle.startsAt ? formatDate(cycle.startsAt) : "-"}`,
        `ends\t${cycle.endsAt ? formatDate(cycle.endsAt) : "-"}`,
        `progress\t${
          Math.round((cycle.progress ?? 0) * 100)
        }% (${completedCount}/${totalCount})`,
      ]
      console.log(lines.join("\n"))
      return
    }

    render("table", {
      title: `${cycleName} (#${cycle.number})`,
      fields: [
        {
          label: "Period",
          value: `${cycle.startsAt ? formatDate(cycle.startsAt) : "?"} → ${
            cycle.endsAt ? formatDate(cycle.endsAt) : "?"
          }`,
        },
        {
          label: "Progress",
          value: `${
            Math.round((cycle.progress ?? 0) * 100)
          }% (${completedCount}/${totalCount} issues)`,
        },
      ],
    })

    if (issueRows.length > 0) {
      console.log("\nIssues:")
      for (const r of issueRows) {
        console.log(
          `  ${r.identifier}  ${r.state}  ${r.assignee}  ${r.title}    ${
            relativeTime(r.updatedAt)
          }`,
        )
      }
    }
  })

export const cycleCommand = new Command()
  .description("Manage cycles")
  .command("list", listCommand)
  .command("view", viewCommand)
