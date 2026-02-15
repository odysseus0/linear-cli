import { Command } from "@cliffy/command"
import { CliError } from "../../errors.ts"
import { render } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import { resolveProjectByName } from "../../resolve.ts"
import { getCommandContext } from "../_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "../_shared/mutation_output.ts"

export const milestoneListCommand = new Command()
  .description("List milestones for a project")
  .example("List milestones", "linear project milestone list 'My Project'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)

    const project = await resolveProjectByName(client, name)
    const milestones = await project.projectMilestones()

    const payload = milestones.nodes.map((m) => ({
      name: m.name,
      status: String(m.status ?? "-"),
      targetDate: m.targetDate ?? "-",
      progress: `${Math.round((m.progress ?? 0) * 100)}%`,
      description: m.description ?? "-",
    }))

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "table") {
      render("table", {
        headers: ["Name", "Status", "Target", "Progress", "Description"],
        rows: payload.map((r) => [
          r.name,
          r.status,
          r.targetDate,
          r.progress,
          r.description.length > 50
            ? r.description.slice(0, 47) + "..."
            : r.description,
        ]),
      })
    } else {
      render("compact", {
        headers: ["Name", "Status", "Target", "Progress"],
        rows: payload.map((r) => [r.name, r.status, r.targetDate, r.progress]),
      })
    }
  })

export const milestoneCreateCommand = new Command()
  .alias("add")
  .description("Create milestone on a project")
  .example(
    "Add milestone",
    "linear project milestone create 'Beta launch' --project 'My Project' --target-date 2026-03-15",
  )
  .arguments("<name:string>")
  .option("--project <project:string>", "Project name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .option("--date <date:string>", "Alias for --target-date", { hidden: true })
  .action(async (options, milestoneName: string) => {
    const { format, client } = await getCommandContext(options)
    const project = await resolveProjectByName(client, options.project)

    const targetDate = options.targetDate ?? (options as { date?: string }).date
    const payload = await client.createProjectMilestone({
      projectId: project.id,
      name: milestoneName,
      ...(options.description && { description: options.description }),
      ...(targetDate && { targetDate }),
    })
    const milestone = await payload.projectMilestone

    if (!milestone) {
      throw new CliError("failed to create milestone", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: milestone.id,
        entity: "projectMilestone",
        action: "create",
        status: "success",
        metadata: {
          name: milestone.name,
          targetDate: milestone.targetDate ?? null,
          description: milestone.description ?? null,
        },
      }),
    })
  })

export const milestoneCommand = new Command()
  .description("Manage project milestones")
  .command("list", milestoneListCommand)
  .command("create", milestoneCreateCommand)
