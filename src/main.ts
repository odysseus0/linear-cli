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
  start: "start",
  begin: "start",
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
  "start",
  "close",
  "reopen",
  "assign",
])

const ISSUE_ID_RE = /^[A-Za-z]+-\d+$/

/**
 * Pre-process args to reorder ID-first patterns before Cliffy parsing.
 * `issue POL-5 close` → `issue close POL-5`
 * `issue POL-5` → `issue view POL-5`
 */
function preprocessArgs(args: string[]): string[] {
  if (args.length < 2) return args
  const cmd = args[0]?.toLowerCase()
  if (cmd !== "issue" && cmd !== "issues") return args

  // args[1] must look like an issue identifier
  if (!ISSUE_ID_RE.test(args[1])) return args

  const id = args[1]
  const verb = args[2]?.toLowerCase()

  // No verb after ID, or next arg is a flag → implicit "view"
  if (!verb || verb.startsWith("-")) {
    return [args[0], "view", id, ...args.slice(2)]
  }

  // Known synonym → map and reorder
  const mapped = VERB_MAP[verb]
  if (mapped) {
    return [args[0], mapped, id, ...args.slice(3)]
  }

  // Direct subcommand → reorder without mapping
  if (DIRECT_SUBCOMMANDS.has(verb)) {
    return [args[0], verb, id, ...args.slice(3)]
  }

  // Unknown verb — pass through unchanged, let Cliffy handle it
  return args
}

try {
  await app.parse(preprocessArgs([...Deno.args]))
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
      // --body/--health/--status on project update → redirect to project post
      if (
        (opt === "--body" || opt === "--health" || opt === "--status") &&
        (parent === "project" || parent === "projects") &&
        Deno.args[1]?.toLowerCase() === "update"
      ) {
        const projectName = Deno.args[2] ?? "<name>"
        console.error(
          `error: ${opt} is for status posts, not metadata updates`,
        )
        console.error(
          `  try: linear project post "${projectName}" --body <text> --health <onTrack|atRisk|offTrack>`,
        )
        Deno.exit(4)
      }
    }

    // Check for unknown command errors — provide smart suggestions
    const unknownMatch = error.message.match(/Unknown command "([^"]+)"/)
    if (unknownMatch) {
      const input = unknownMatch[1]

      // Detect "issue <identifier> <verb>" pattern (e.g., "issue POL-64 done")
      // Uses module-scope VERB_MAP and DIRECT_SUBCOMMANDS
      const parent = Deno.args[0]?.toLowerCase()
      if (
        (parent === "issue" || parent === "issues") &&
        ISSUE_ID_RE.test(input)
      ) {
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
