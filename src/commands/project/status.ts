import { Command } from "@cliffy/command"
import type { ProjectUpdateHealthType } from "@linear/sdk"
import { CliError } from "../../errors.ts"
import { readStdin, resolveProjectByName } from "../../resolve.ts"
import { getCommandContext } from "../_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "../_shared/mutation_output.ts"
import { renderTableHint } from "../_shared/streams.ts"
import { HEALTH_MAP, resolveProjectStatusId } from "./shared.ts"

export const postCommand = new Command()
  .description("Create project update (status post)")
  .example(
    "Post status update",
    "linear project post 'My Project' --body 'On track' --health onTrack",
  )
  .arguments("<name:string>")
  .option("--body <text:string>", "Update body in markdown")
  .option("--health <health:string>", "Health: onTrack, atRisk, offTrack")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const body = options.body ?? (await readStdin())

    let health: ProjectUpdateHealthType | undefined
    if (options.health) {
      health = HEALTH_MAP[options.health.toLowerCase()]
      if (!health) {
        throw new CliError(
          `invalid health "${options.health}"`,
          4,
          "try: onTrack, atRisk, offTrack",
        )
      }
    }

    const payload = await client.createProjectUpdate({
      projectId: project.id,
      ...(body && { body }),
      ...(health && { health }),
    })
    const update = await payload.projectUpdate
    if (!update) {
      throw new CliError("failed to create project update", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: update.id,
        entity: "projectUpdate",
        action: "create",
        status: "success",
        url: update.url,
        metadata: {
          project: project.name,
          health: update.health ?? null,
          createdAt: update.createdAt,
        },
      }),
    })
  })

export const startCommand = new Command()
  .description("Start project (set state to started)")
  .example("Start a project", "linear project start 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "started")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "start",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
    renderTableHint(
      format,
      `  post update: linear project post '${name}' --body '<text>'`,
    )
  })

export const pauseCommand = new Command()
  .description("Pause project (set state to paused)")
  .example("Pause a project", "linear project pause 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "paused")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "pause",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

export const completeCommand = new Command()
  .description("Complete project (set state to completed)")
  .example("Complete a project", "linear project complete 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "completed")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "complete",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

export const cancelCommand = new Command()
  .description("Cancel project (set state to canceled)")
  .example("Cancel a project", "linear project cancel 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)
    const statusId = await resolveProjectStatusId(client, "canceled")
    await client.updateProject(project.id, { statusId })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "cancel",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })
