import { Command, ValidationError } from "@cliffy/command"
import { CompletionsCommand } from "@cliffy/command/completions"
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
import { inboxCommand } from "./commands/inbox.ts"
import { getCommandContext } from "./commands/_shared/context.ts"
import { buildIndex, suggestCommand } from "./suggest.ts"
import { render } from "./output/formatter.ts"
import { renderJson } from "./output/json.ts"
import denoConfig from "../deno.json" with { type: "json" }

/** Set NO_COLOR env var so Deno.noColor and @std/fmt/colors strip ANSI. */
function disableColor(): void {
  Deno.env.set("NO_COLOR", "1")
}

// Strip ANSI codes when output is piped or terminal is dumb
if (!Deno.stdout.isTerminal() || Deno.env.get("TERM") === "dumb") {
  disableColor()
}

// Handle --no-color flag before Cliffy parses args
const rawArgs = [...Deno.args]
const noColorIdx = rawArgs.indexOf("--no-color")
if (noColorIdx !== -1) {
  disableColor()
  rawArgs.splice(noColorIdx, 1)
}

const DEFAULT_FORMAT: Format = Deno.stdout.isTerminal() ? "table" : "compact"

const app = new Command()
  .name("linear")
  .version(denoConfig.version)
  .throwErrors()
  .description("Agent-native Linear CLI")
  .meta("Repository", "https://github.com/odysseus0/linear-cli")
  .meta("Exit codes", "0 success, 1 runtime, 2 auth, 3 not-found, 4 usage")
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
  .globalOption("--no-input", "Disable interactive prompts", {
    default: false,
  })
  .command("auth", authCommand)
  .command("team", teamCommand)
  .command("issue", issueCommand)
  .command("project", projectCommand)
  .command("cycle", cycleCommand)
  .command("user", userCommand)
  .command("document", documentCommand)
  .command("initiative", initiativeCommand)
  .command("inbox", inboxCommand)
  .command(
    "me",
    new Command()
      .description(
        "Show current authenticated user (shorthand for user view me)",
      )
      .action(async (options) => {
        const { format, client } = await getCommandContext(options)

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
  .command("completions", new CompletionsCommand())
  .command(
    "help",
    new Command()
      .description("Show help")
      .arguments("[command:string]")
      .action((_options, command?: string) => {
        if (command) {
          // Try to show help for a specific subcommand
          const sub = app.getCommand(command, false)
          if (sub) {
            sub.showHelp()
            return
          }
          console.error(`error: unknown command "${command}"`)
          const suggestions = suggestCommand(
            command,
            commandIndex,
            topLevelNames,
          )
          if (suggestions.length) {
            console.error(`  try: ${suggestions.join(", ")}`)
          } else {
            console.error(
              `  available help topics: ${topLevelNames.join(", ")}`,
            )
            console.error(`  try: linear help <topic>`)
          }
          Deno.exit(4)
        }
        app.showHelp()
      }),
  )

// Build the command index for smart suggestions
const commandIndex = buildIndex(app)
const topLevelNames = app.getCommands(false).map((c) => c.getName())

const GLOBAL_OPTIONS_WITH_VALUE = new Set(["-f", "--format", "-t", "--team"])
const GLOBAL_FLAG_OPTIONS = new Set(["--json", "--no-input", "--no-color"])

function getCommandPath(args: string[]): string[] {
  const path: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (arg === "--") break

    if (arg.startsWith("-")) {
      const [flag] = arg.split("=", 1)
      if (GLOBAL_OPTIONS_WITH_VALUE.has(flag) && !arg.includes("=")) {
        i += 1
      }
      if (GLOBAL_FLAG_OPTIONS.has(flag)) {
        continue
      }
      continue
    }

    path.push(arg)
    if (path.length >= 2) break
  }

  return path
}

function getValidationHint(args: string[]): string {
  const [parent, sub] = getCommandPath(args)
  if (!parent) return "linear help"
  if (parent === "help" && sub) return `linear help ${sub}`
  if (!sub) return `linear help ${parent}`
  return `linear help ${parent} ${sub}`
}

function getValidationMessageHint(
  message: string,
  args: string[],
): string {
  const contextualHelp = getValidationHint(args)

  const unknownOpt = message.match(/Unknown option "([^"]+)"/)
  if (unknownOpt) {
    const opt = unknownOpt[1]
    return `${contextualHelp} (check supported options; remove ${opt} if not needed)`
  }

  const missingOptValue = message.match(/Option "([^"]+)" requires value/)
  if (missingOptValue) {
    const opt = missingOptValue[1]
    return `${contextualHelp} (provide a value for ${opt})`
  }

  const missingRequiredOpts = message.match(/Missing required options?: (.+)$/)
  if (missingRequiredOpts) {
    const required = missingRequiredOpts[1]
    return `${contextualHelp} (required option(s): ${required})`
  }

  const missingArgValue = message.match(/Argument "([^"]+)" requires value/)
  if (missingArgValue) {
    const arg = missingArgValue[1]
    return `${contextualHelp} (missing value for ${arg})`
  }

  const missingRequiredArgs = message.match(
    /Missing required arguments?: (.+)$/,
  )
  if (missingRequiredArgs) {
    const required = missingRequiredArgs[1]
    return `${contextualHelp} (required argument(s): ${required})`
  }

  const tooManyArgs = message.match(/Too many arguments/)
  if (tooManyArgs) {
    return `${contextualHelp} (too many positional arguments; check argument order)`
  }

  const unexpectedArg = message.match(/Unexpected argument "([^"]+)"/)
  if (unexpectedArg) {
    const arg = unexpectedArg[1]
    return `${contextualHelp} (unexpected argument: ${arg})`
  }

  const invalidType = message.match(
    /Invalid type for (?:argument|option) "([^"]+)"/,
  )
  if (invalidType) {
    const target = invalidType[1]
    return `${contextualHelp} (invalid type for ${target}; check expected type in help)`
  }

  const invalidValue = message.match(
    /Invalid value for (?:argument|option) "([^"]+)"/,
  )
  if (invalidValue) {
    const target = invalidValue[1]
    return `${contextualHelp} (invalid value for ${target}; check allowed values in help)`
  }

  const choices = message.match(/Expected one of: (.+)$/)
  if (choices) {
    return `${contextualHelp} (allowed values: ${choices[1]})`
  }

  return contextualHelp
}

try {
  await app.parse(rawArgs)
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
      // Suggest reordered form; Cliffy alias resolution handles synonyms
      const parent = Deno.args[0]?.toLowerCase()
      if (
        (parent === "issue" || parent === "issues") &&
        /^[A-Za-z]+-\d+$/.test(input)
      ) {
        const idxOfId = Deno.args.indexOf(input)
        const verb = idxOfId >= 0 ? Deno.args[idxOfId + 1] : undefined
        const subcmd = verb && !verb.startsWith("-") ? verb : "view"
        const restArgs = verb && !verb.startsWith("-")
          ? Deno.args.slice(idxOfId + 2)
          : Deno.args.slice(idxOfId + 1)
        const rest = restArgs.length ? " " + restArgs.join(" ") : ""
        console.error(`error: unknown command "${input}"`)
        console.error(
          `  try: linear issue ${subcmd} ${input}${rest}`,
        )
        Deno.exit(4)
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
      console.error(
        `  try: ${getValidationMessageHint(error.message, Deno.args)}`,
      )
    }
    Deno.exit(4)
  }

  // Network error catch-all
  const msg = error instanceof Error ? error.message : String(error)

  if (msg.includes("fetch failed") || msg.includes("NetworkError")) {
    console.error(
      "error: network request failed — check your connection",
    )
    Deno.exit(1)
  }
  if (msg.includes("401") || msg.includes("Unauthorized")) {
    console.error("error: authentication failed — run: linear auth login")
    Deno.exit(2)
  }
  if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
    console.error("error: rate limited — try again shortly")
    Deno.exit(1)
  }

  console.error(`error: ${msg}`)
  Deno.exit(1)
}
