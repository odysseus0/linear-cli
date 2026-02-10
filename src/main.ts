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
  .globalOption("-t, --team <team:string>", "Team key")
  .command("auth", authCommand)
  .command("team", teamCommand)
  .command("issue", issueCommand)
  .command("project", projectCommand)
  .command("cycle", cycleCommand)
  .command("user", userCommand)
  .command("document", documentCommand)
  .command("initiative", initiativeCommand)

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
    // Check for unknown command errors — provide smart suggestions
    const unknownMatch = error.message.match(/Unknown command "([^"]+)"/)
    if (unknownMatch) {
      const input = unknownMatch[1]
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
