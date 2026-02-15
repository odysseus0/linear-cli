import { Command } from "@cliffy/command"
import { CliError } from "../../errors.ts"
import { renderMessage } from "../../output/formatter.ts"
import {
  readStdin,
  resolveIssue,
  resolveProjectByName,
  resolveTeam,
  resolveUser,
} from "../../resolve.ts"
import { confirmDangerousAction } from "../_shared/confirm.ts"
import { getCommandContext } from "../_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "../_shared/mutation_output.ts"
import { renderTableHint } from "../_shared/streams.ts"

export const createCommand = new Command()
  .description("Create project")
  .example(
    "Create a project",
    "linear project create --name 'Q1 Roadmap' --target-date 2026-03-31",
  )
  .option("--name <name:string>", "Project name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--lead <name:string>", "Project lead")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const description = options.description ?? await readStdin()
    const leadId = options.lead
      ? await resolveUser(client, options.lead)
      : undefined

    let teamIds: string[] = []
    const teamKey = (options as unknown as { team?: string }).team
    if (teamKey) {
      const team = await resolveTeam(client, teamKey)
      teamIds = [team.id]
    }

    const payload = await client.createProject({
      name: options.name,
      teamIds,
      ...(description && { description }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(leadId && { leadId }),
    })
    const project = await payload.project

    if (!project) {
      throw new CliError("failed to create project", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "create",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
    renderTableHint(
      format,
      `  add issues: linear project add-issue '${project.name}' <issue-id>`,
    )
  })

export const updateCommand = new Command()
  .description("Update project")
  .example(
    "Update target date",
    "linear project update 'My Project' --target-date 2026-04-01",
  )
  .arguments("<name:string>")
  .option("--name <name:string>", "New name")
  .option("-d, --description <desc:string>", "New description")
  .option("--lead <name:string>", "New lead (empty to unassign)")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--start-date <date:string>", "Start date (YYYY-MM-DD)")
  .option("--color <color:string>", "Project color hex")
  .option("--status <status:string>", "Redirect: use project post instead", {
    hidden: true,
  })
  .action(async (options, projectName: string) => {
    if ((options as { status?: string }).status) {
      throw new CliError(
        "project update does not have a --status flag",
        4,
        `linear project post "${projectName}" --body <text> --health <onTrack|atRisk|offTrack>`,
      )
    }

    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, projectName)
    const description = options.description ?? (await readStdin())
    const leadId = options.lead !== undefined
      ? (options.lead === "" ? null : await resolveUser(client, options.lead))
      : undefined

    const payload = await client.updateProject(project.id, {
      ...(options.name && { name: options.name }),
      ...(description !== undefined && { description }),
      ...(leadId !== undefined && { leadId }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(options.startDate && { startDate: options.startDate }),
      ...(options.color && { color: options.color }),
    })
    const updated = await payload.project

    if (!updated) {
      throw new CliError("failed to update project", 1)
    }

    const lead = await updated.lead
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: updated.id,
        entity: "project",
        action: "update",
        status: "success",
        url: updated.url,
        metadata: {
          name: updated.name,
          state: updated.state ?? "-",
          progress: `${Math.round((updated.progress ?? 0) * 100)}%`,
          lead: lead?.name ?? null,
          targetDate: updated.targetDate ?? null,
        },
      }),
    })
  })

export const deleteCommand = new Command()
  .description("Delete project")
  .example("Delete a project", "linear project delete 'My Project'")
  .example(
    "Delete without confirmation",
    "linear project delete 'My Project' --yes",
  )
  .arguments("<name:string>")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options, name: string) => {
    const { format, client, noInput } = await getCommandContext(options)
    const project = await resolveProjectByName(client, name)

    const confirmed = await confirmDangerousAction({
      prompt: `Delete project "${project.name}"?`,
      skipConfirm: Boolean((options as { yes?: boolean }).yes) || noInput,
    })
    if (!confirmed) {
      renderMessage(format, "Canceled")
      return
    }

    await client.deleteProject(project.id)
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: project.id,
        entity: "project",
        action: "delete",
        status: "success",
        url: project.url,
        metadata: { name: project.name },
      }),
    })
  })

export const addIssueCommand = new Command()
  .description("Add issue to project")
  .example(
    "Add issue to project",
    "linear project add-issue 'My Project' POL-5",
  )
  .arguments("<project:string> <issue:string>")
  .action(async (options, projectName: string, issueId: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const project = await resolveProjectByName(client, projectName)
    const issue = await resolveIssue(client, issueId, teamKey)

    await client.updateIssue(issue.id, { projectId: project.id })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: issue.identifier,
        entity: "issue",
        action: "moveToProject",
        status: "success",
        url: issue.url,
        metadata: { project: project.name },
      }),
    })
  })
