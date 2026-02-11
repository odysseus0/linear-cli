import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { CliError } from "../errors.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { requireTeam } from "../resolve.ts"

interface TeamSummary {
  key: string
  name: string
  issueCount: number
  cyclesEnabled: boolean
}

async function loadTeams(apiKey: string): Promise<TeamSummary[]> {
  const client = createClient(apiKey)
  const teamsConnection = await client.teams()
  return teamsConnection.nodes.map((team) => ({
    key: team.key,
    name: team.name,
    issueCount: team.issueCount ?? 0,
    cyclesEnabled: team.cyclesEnabled ?? false,
  }))
}

async function findTeam(apiKey: string, key: string) {
  const client = createClient(apiKey)
  const teamsConnection = await client.teams()
  const teams = teamsConnection.nodes
  const target = teams.find((t) => t.key.toLowerCase() === key.toLowerCase())
  if (!target) {
    const available = teams.map((t) => t.key).join(", ")
    throw new CliError(`team not found: "${key}"`, 3, `available: ${available}`)
  }
  return target
}

export const teamCommand = new Command()
  .description("Manage teams")
  .alias("teams")
  .example("List teams", "linear team list")
  .example("View team", "linear team view POL")
  .command(
    "list",
    new Command()
      .description("List teams")
      .example("List all teams", "linear team list")
      .action(async (options) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const teams = await loadTeams(apiKey)
        if (format === "json") {
          renderJson(teams)
          return
        }
        render(format, {
          headers: ["Key", "Name", "Issues", "Cycles"],
          rows: teams.map((entry) => [
            entry.key,
            entry.name,
            String(entry.issueCount),
            entry.cyclesEnabled ? "Yes" : "No",
          ]),
        })
      }),
  )
  .command(
    "view",
    new Command()
      .alias("show")
      .description("View team details")
      .example("View a team", "linear team view POL")
      .arguments("<key:string>")
      .action(async (options, key: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const target = await findTeam(apiKey, key)
        const membersConnection = await target.members()
        const members = membersConnection.nodes
        const details = {
          key: target.key,
          name: target.name,
          description: target.description ?? "-",
          issues: target.issueCount ?? 0,
          cycles: target.cyclesEnabled ? "Enabled" : "Disabled",
          members: members.length,
          createdAt: target.createdAt
            ? new Date(target.createdAt).toISOString().slice(0, 10)
            : "-",
        }
        if (format === "json") {
          renderJson(details)
          return
        }
        render(format, {
          title: `${details.name} (${details.key})`,
          fields: [
            { label: "Description", value: details.description },
            { label: "Issues", value: String(details.issues) },
            { label: "Cycles", value: details.cycles },
            { label: "Members", value: String(details.members) },
            { label: "Created", value: details.createdAt },
          ],
        })
      }),
  )
  .command(
    "members",
    new Command()
      .description("List team members")
      .example("List team members", "linear team members POL")
      .arguments("<key:string>")
      .action(async (options, key: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const target = await findTeam(apiKey, key)
        const membersConnection = await target.members()
        const members = membersConnection.nodes
        if (format === "json") {
          renderJson(
            members.map((member) => ({
              name: member.name,
              email: member.email,
              admin: member.admin ?? false,
              active: member.active ?? true,
            })),
          )
          return
        }
        render(format, {
          headers: ["Name", "Email", "Admin", "Active"],
          rows: members.map((member) => [
            member.name ?? "Unknown",
            member.email ?? "-",
            member.admin ? "yes" : "no",
            member.active ? "yes" : "no",
          ]),
        })
      }),
  )
  .command(
    "overview",
    new Command()
      .description("Team status dashboard")
      .example("Team overview", "linear team overview POL")
      .arguments("[key:string]")
      .action(async (options, key?: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        // Positional arg takes precedence over --team flag
        const teamKey = key ?? requireTeam(options)
        const client = createClient(apiKey)

        const target = await findTeam(apiKey, teamKey)

        // Progress indication for slow overview fetch
        if (Deno.stderr.isTerminal()) Deno.stderr.writeSync(new TextEncoder().encode("Fetching...\r"))

        // Fetch all active issues for the team
        const issues = await client.issues({
          filter: {
            team: { key: { eq: teamKey } },
            state: {
              type: { in: ["backlog", "unstarted", "started", "completed"] },
            },
          },
          first: 200,
        })

        // Build assignee × state matrix
        const stateTypes = ["Backlog", "Todo", "In Progress", "Done"]
        const matrix: Record<string, Record<string, number>> = {}

        for (const issue of issues.nodes) {
          const assignee = await issue.assignee
          const state = await issue.state
          const assigneeName = assignee?.name ?? "Unassigned"
          const stateType = state?.type ?? "backlog"

          // Map state types to display names
          let displayState: string
          switch (stateType) {
            case "backlog":
            case "triage":
              displayState = "Backlog"
              break
            case "unstarted":
              displayState = "Todo"
              break
            case "started":
              displayState = "In Progress"
              break
            case "completed":
              displayState = "Done"
              break
            default:
              displayState = "Backlog"
          }

          if (!matrix[assigneeName]) {
            matrix[assigneeName] = {}
            for (const s of stateTypes) matrix[assigneeName][s] = 0
          }
          matrix[assigneeName][displayState] =
            (matrix[assigneeName][displayState] ?? 0) + 1
        }

        const assignees = Object.keys(matrix).sort((a, b) => {
          if (a === "Unassigned") return 1
          if (b === "Unassigned") return -1
          return a.localeCompare(b)
        })

        const total = issues.nodes.length
        const inProgress = Object.values(matrix).reduce(
          (sum, row) => sum + (row["In Progress"] ?? 0),
          0,
        )
        const done = Object.values(matrix).reduce(
          (sum, row) => sum + (row["Done"] ?? 0),
          0,
        )

        if (format === "json") {
          renderJson({ teamKey, matrix, total, inProgress, done })
          return
        }

        if (format === "table") {
          console.log(`${target.name} (${target.key}) — Overview\n`)
        }

        render(format, {
          headers: ["Assignee", ...stateTypes],
          rows: assignees.map((name) => [
            name,
            ...stateTypes.map((s) => String(matrix[name][s] ?? 0)),
          ]),
        })

        if (format === "table") {
          console.log(
            `\nTotal: ${total} issues | ${inProgress} in progress | ${done} done`,
          )
        }
      }),
  )
  .command(
    "states",
    new Command()
      .description("List workflow states for a team")
      .example("List workflow states", "linear team states POL")
      .arguments("<key:string>")
      .action(async (options, key: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const target = await findTeam(apiKey, key)
        const statesConn = await target.states()
        const states = statesConn.nodes

        if (format === "json") {
          renderJson(
            states.map((s) => ({
              name: s.name,
              type: s.type,
              color: s.color,
              position: s.position,
            })),
          )
          return
        }

        render(format, {
          headers: ["Name", "Type", "Color", "Position"],
          rows: states.map((s) => [
            s.name,
            s.type,
            s.color,
            String(s.position),
          ]),
        })
      }),
  )
  .command(
    "labels",
    new Command()
      .description("List labels for a team")
      .example("List team labels", "linear team labels POL")
      .arguments("<key:string>")
      .action(async (options, key: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const target = await findTeam(apiKey, key)
        const labelsConn = await target.labels()
        const labels = labelsConn.nodes

        if (format === "json") {
          renderJson(
            labels.map((l) => ({
              name: l.name,
              color: l.color,
              description: l.description ?? "",
            })),
          )
          return
        }

        render(format, {
          headers: ["Name", "Color", "Description"],
          rows: labels.map((l) => [
            l.name,
            l.color,
            l.description ?? "-",
          ]),
        })
      }),
  )
