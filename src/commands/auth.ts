import { Command } from "@cliffy/command"
import { Input } from "@cliffy/prompt"
import type { LinearClient } from "@linear/sdk"
import { createClient } from "../client.ts"
import { removeCredentials, saveCredentials } from "../auth.ts"
import { CliError } from "../errors.ts"
import { getFormat } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { getCommandContext } from "./_shared/context.ts"

interface ViewerInfo {
  name: string
  email: string
  admin: boolean
  active: boolean
  workspace: string
}

async function fetchViewerInfoFromClient(
  client: LinearClient,
): Promise<ViewerInfo> {
  try {
    const viewer = await client.viewer
    const organization = await viewer.organization
    const workspace = organization?.urlKey ?? organization?.name ?? "unknown"
    return {
      name: viewer.name ?? "Unknown",
      email: viewer.email ?? "",
      admin: viewer.admin ?? false,
      active: viewer.active ?? true,
      workspace,
    }
  } catch (_error) {
    throw new CliError(
      "invalid API key",
      2,
      "check your API key at linear.app/settings/api",
    )
  }
}

async function fetchViewerInfo(apiKey: string): Promise<ViewerInfo> {
  const client = createClient(apiKey)
  return await fetchViewerInfoFromClient(client)
}

export const authCommand = new Command()
  .description("Manage authentication")
  .command(
    "login",
    new Command()
      .description("Authenticate with Linear")
      .option("--key <key:string>", "API key")
      .action(async (options) => {
        const format = getFormat(options)
        const envKey = Deno.env.get("LINEAR_API_KEY")
        const apiKey = options.key ?? envKey ??
          await Input.prompt(
            "Enter your Linear API key (create at https://linear.app/settings/api):",
          )
        const viewer = await fetchViewerInfo(apiKey)
        await saveCredentials(viewer.workspace, apiKey)
        renderMessage(
          format,
          `Authenticated as ${viewer.name} in workspace ${viewer.workspace}`,
        )
      }),
  )
  .command(
    "logout",
    new Command()
      .description("Remove stored credentials")
      .action(async (options) => {
        const { format, client } = await getCommandContext(options)
        const viewer = await fetchViewerInfoFromClient(client)
        await removeCredentials(viewer.workspace)
        renderMessage(format, `Logged out of workspace ${viewer.workspace}`)
      }),
  )
  .command(
    "status",
    new Command()
      .description("Show authentication status")
      .action(async (options) => {
        const { format, client } = await getCommandContext(options)
        const viewer = await fetchViewerInfoFromClient(client)
        renderMessage(
          format,
          `Authenticated as ${viewer.name} (${viewer.email})\nWorkspace: ${viewer.workspace}`,
        )
      }),
  )
  .command(
    "whoami",
    new Command()
      .description("Show current user")
      .action(async (options) => {
        const { format, client } = await getCommandContext(options)
        const payload = await fetchViewerInfoFromClient(client)
        if (format === "json") {
          renderJson(payload)
          return
        }
        render(format, {
          headers: ["Name", "Email", "Admin", "Active"],
          rows: [[
            payload.name,
            payload.email || "-",
            payload.admin ? "yes" : "no",
            payload.active ? "yes" : "no",
          ]],
        })
      }),
  )
