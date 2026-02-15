import type { LinearClient } from "@linear/sdk"
import { getAPIKey } from "../../auth.ts"
import { createClient } from "../../client.ts"
import type { Format } from "../../output/formatter.ts"
import { requireTeam } from "../../resolve.ts"
import { getFormat } from "../../types.ts"

export interface CommandContext {
  format: Format
  client: LinearClient
  noInput: boolean
}

export interface TeamCommandContext extends CommandContext {
  teamKey: string
}

interface CommandContextOptions {
  requireTeam?: boolean
}

export async function getCommandContext(
  options: unknown,
  config: { requireTeam: true },
): Promise<TeamCommandContext>
export async function getCommandContext(
  options: unknown,
  config?: CommandContextOptions,
): Promise<CommandContext>
export async function getCommandContext(
  options: unknown,
  config: CommandContextOptions = {},
): Promise<CommandContext | TeamCommandContext> {
  const format = getFormat(options)
  const apiKey = await getAPIKey()
  const client = createClient(apiKey)
  const noInput = Boolean((options as { noInput?: boolean }).noInput)

  if (config.requireTeam) {
    return {
      format,
      client,
      noInput,
      teamKey: requireTeam(options),
    }
  }

  return { format, client, noInput }
}
