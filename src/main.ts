import { Command } from "@cliffy/command"
import { CliError } from "./errors.ts"
import type { Format } from "./output/formatter.ts"
import { authCommand } from "./commands/auth.ts"
import { teamCommand } from "./commands/team.ts"
import { issueCommand } from "./commands/issue.ts"
import { projectCommand } from "./commands/project.ts"
import { cycleCommand } from "./commands/cycle.ts"

const DEFAULT_FORMAT: Format = Deno.stdout.isTerminal() ? "table" : "compact"

const app = new Command()
  .name("linear-cli")
  .version("0.1.0")
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
  throw error
}
