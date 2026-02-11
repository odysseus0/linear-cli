import { Command, ValidationError } from "@cliffy/command"
import { CliError } from "./errors.ts"
import type { Format } from "./output/formatter.ts"
import { authCommand } from "./commands/auth.ts"
import { teamCommand } from "./commands/team.ts"
import { issueCommand } from "./commands/issue.ts"
import { projectCommand } from "./commands/project.ts"
import { cycleCommand } from "./commands/cycle.ts"
import { userCommand } from "./commands/user.ts"
import { documentCommand } from "./commands/document.ts"
import { initiativeCommand } from "./commands/initiative.ts"
import { buildIndex, suggestCommand } from "./suggest.ts"
import { createClient } from "./client.ts"
import { getAPIKey } from "./auth.ts"
import { getFormat } from "./types.ts"
import { render } from "./output/formatter.ts"
import { renderJson } from "./output/json.ts"
import denoConfig from "../deno.json" with { type: "json" }

const DEFAULT_FORMAT: Format = Deno.stdout.isTerminal() ? "table" : "compact"

const app = new Command()
  .name("linear")
  .version(denoConfig.version)
  .throwErrors()
  .description("Agent-native Linear CLI")
  .globalOption(
    "-f, --format <format:string>",
    "Output format: table, compact, json",
    {
      default: DEFAULT_FORMAT,
    },
  )
  .globalOption("--json", "Output JSON (shorthand for --format json)", {
    hidden: true,
  })
  .globalOption("-t, --team <team:string>", "Team key")
  .command("auth", authCommand)
  .command("team", teamCommand)
  .command("issue", issueCommand)
  .command("project", projectCommand)
  .command("cycle", cycleCommand)
  .command("user", userCommand)
  .command("document", documentCommand)
  .command("initiative", initiativeCommand)
  .command(
    "me",
    new Command()
      .description(
        "Show current authenticated user (shorthand for user view me)",
      )
      .action(async (options) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const client = createClient(apiKey)

        const user = await client.viewer

        const details = {
          name: user.name,
          displayName: user.displayName,
          email: user.email ?? "-",
          admin: user.admin ?? false,
          active: user.active ?? true,
          createdAt: user.createdAt
            ? new Date(user.createdAt).toISOString().slice(0, 10)
            : "-",
        }

        if (format === "json") {
          renderJson(details)
          return
        }

        render(format, {
          title: details.name,
          fields: [
            { label: "Display Name", value: details.displayName },
            { label: "Email", value: details.email },
            { label: "Admin", value: details.admin ? "yes" : "no" },
            { label: "Active", value: details.active ? "yes" : "no" },
            { label: "Created", value: details.createdAt },
          ],
        })
      }),
  )

// Build the command index for smart suggestions
const commandIndex = buildIndex(app)
const topLevelNames = app.getCommands(false).map((c) => c.getName())

try {
  await app.parse(Deno.args)
} catch (error) {
  if (error instanceof CliError) {
    console.error(`error: ${error.message}`)
    if (error.hint) {
      console.error(`  try: ${error.hint}`)
    }
    Deno.exit(error.code)
  }
  if (error instanceof ValidationError) {
    // --mine on parent issue command → redirect to issue list --mine
    const unknownOpt = error.message.match(/Unknown option "([^"]+)"/)
    if (unknownOpt) {
      const opt = unknownOpt[1]
      const parent = Deno.args[0]?.toLowerCase()
      if (
        opt === "--mine" &&
        (parent === "issue" || parent === "issues")
      ) {
        console.error(`error: --mine belongs on the list subcommand`)
        console.error(`  try: linear issue list --mine --team <KEY>`)
        Deno.exit(4)
      }
    }

    // Check for unknown command errors — provide smart suggestions
    const unknownMatch = error.message.match(/Unknown command "([^"]+)"/)
    if (unknownMatch) {
      const input = unknownMatch[1]

      // Detect "issue <identifier> <verb>" pattern (e.g., "issue POL-64 done")
      const parent = Deno.args[0]?.toLowerCase()
      if (
        (parent === "issue" || parent === "issues") &&
        /^[A-Za-z]+-\d+$/.test(input)
      ) {
        // Synonym verbs that map to porcelain subcommands
        const VERB_MAP: Record<string, string> = {
          done: "close",
          close: "close",
          finish: "close",
          complete: "close",
          resolve: "close",
          open: "reopen",
          reopen: "reopen",
          assign: "assign",
        }
        // Direct subcommand names (no synonym mapping needed)
        const DIRECT_SUBCOMMANDS = new Set([
          "comment",
          "view",
          "show",
          "update",
          "delete",
          "branch",
          "list",
        ])

        // Look for a verb/subcommand after the identifier in args
        const idxOfId = Deno.args.indexOf(input)
        const nextArg = idxOfId >= 0
          ? Deno.args[idxOfId + 1]?.toLowerCase()
          : undefined
        const porcelain = nextArg ? VERB_MAP[nextArg] : undefined
        const isDirect = nextArg ? DIRECT_SUBCOMMANDS.has(nextArg) : false

        if (porcelain || isDirect) {
          const subcmd = porcelain ?? nextArg!
          // Collect remaining args after the subcommand for the suggestion
          const restArgs = Deno.args.slice(idxOfId + 2)
          const rest = restArgs.length ? " " + restArgs.join(" ") : ""
          console.error(`error: unknown command "${input}"`)
          console.error(
            `  try: linear issue ${subcmd} ${input}${rest}`,
          )
          Deno.exit(4)
        }
      }

      const suggestions = suggestCommand(input, commandIndex, topLevelNames)
      console.error(`error: unknown command "${input}"`)
      if (suggestions.length) {
        console.error(`  try: ${suggestions.join(", ")}`)
      } else {
        console.error(`  available: ${topLevelNames.join(", ")}`)
      }
    } else {
      console.error(`error: ${error.message}`)
      console.error(`  try: linear --help`)
    }
    Deno.exit(4)
  }
  throw error
}
