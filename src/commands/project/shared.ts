import { type LinearClient, ProjectUpdateHealthType } from "@linear/sdk"
import { CliError } from "../../errors.ts"

export const HEALTH_MAP: Record<string, ProjectUpdateHealthType> = {
  ontrack: ProjectUpdateHealthType.OnTrack,
  atrisk: ProjectUpdateHealthType.AtRisk,
  offtrack: ProjectUpdateHealthType.OffTrack,
}

/** Find project status ID by type (started, paused, completed, canceled). */
export async function resolveProjectStatusId(
  client: LinearClient,
  statusType: string,
): Promise<string> {
  const statuses = await client.projectStatuses()
  const match = statuses.nodes.find(
    (s) => s.type?.toLowerCase() === statusType.toLowerCase(),
  )
  if (!match) {
    throw new CliError(
      `no project status of type "${statusType}" found`,
      1,
      "check project status configuration in Linear settings",
    )
  }
  return match.id
}
