import { Command } from "@cliffy/command"
import { InitiativeStatus } from "@linear/sdk"
import { createClient } from "../client.ts"
import { CliError } from "../errors.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { readStdin, resolveInitiative, resolveUser } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"
import { getCommandContext } from "./_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "./_shared/mutation_output.ts"

// Linear API uses "status" for initiatives (vs "state" for issues)
const listCommand = new Command()
  .description("List initiatives")
  .example("List all initiatives", "linear initiative list")
  .example("List active only", "linear initiative list --status active")
  .example("Filter by owner", "linear initiative list --owner Alice")
  .option(
    "-s, --status <status:string>",
    "Filter: planned, active, completed",
  )
  .option("--owner <name:string>", "Filter by owner name (substring match)")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const initiatives = await client.initiatives()
    let items = initiatives.nodes

    if (options.status) {
      const target = options.status.toLowerCase()
      items = items.filter(
        (i) => i.status.toLowerCase() === target,
      )
    }

    let rows = await Promise.all(
      items.map(async (i) => {
        const owner = await i.owner
        return {
          name: i.name,
          status: i.status,
          owner: owner?.name ?? "-",
          targetDate: i.targetDate ?? "-",
          createdAt: i.createdAt,
        }
      }),
    )

    // Filter by owner (substring, case-insensitive)
    if (options.owner) {
      const needle = options.owner.toLowerCase()
      rows = rows.filter((r) => r.owner.toLowerCase().includes(needle))
    }

    if (format === "json") {
      renderJson(rows)
      return
    }

    render(format, {
      headers: ["Name", "Status", "Owner", "Target", "Created"],
      rows: rows.map((r) => [
        r.name,
        r.status,
        r.owner,
        r.targetDate,
        relativeTime(r.createdAt),
      ]),
    })
  })

const viewCommand = new Command()
  .alias("show")
  .description("View initiative details")
  .example("View an initiative", "linear initiative view 'Q1 Goals'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const initiative = await resolveInitiative(client, name)

    const owner = await initiative.owner
    const creator = await initiative.creator
    const projects = await initiative.projects()
    const payload = {
      id: initiative.id,
      name: initiative.name,
      description: initiative.description ?? null,
      status: initiative.status,
      owner: owner?.name ?? null,
      creator: creator?.name ?? null,
      targetDate: initiative.targetDate ?? null,
      health: initiative.health ?? null,
      url: initiative.url,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      projects: projects.nodes.map((p) => p.name),
    }

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "compact") {
      const lines = [
        `name\t${payload.name}`,
        `status\t${payload.status}`,
        `owner\t${payload.owner ?? "-"}`,
        `target\t${payload.targetDate ?? "-"}`,
        `health\t${payload.health ?? "-"}`,
        `projects\t${payload.projects.join(", ") || "-"}`,
        `url\t${payload.url}`,
      ]
      console.log(lines.join("\n"))
      return
    }

    render("table", {
      title: payload.name,
      fields: [
        { label: "Status", value: payload.status },
        { label: "Owner", value: payload.owner ?? "-" },
        { label: "Creator", value: payload.creator ?? "-" },
        { label: "Target", value: payload.targetDate ?? "-" },
        { label: "Health", value: payload.health ?? "-" },
        {
          label: "Projects",
          value: payload.projects.join(", ") || "-",
        },
        {
          label: "Created",
          value: `${formatDate(payload.createdAt)} (${
            relativeTime(payload.createdAt)
          })`,
        },
        { label: "URL", value: payload.url },
      ],
    })

    if (payload.description) {
      console.log(`\n${payload.description}`)
    }
  })

const createCommand = new Command()
  .description("Create initiative")
  .example(
    "Create an initiative",
    "linear initiative create --name 'Q1 Goals' --status active",
  )
  .option("--name <name:string>", "Initiative name", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("--owner <name:string>", "Initiative owner")
  .option(
    "-s, --status <status:string>",
    "Status: planned, active, completed",
  )
  .option("--target-date <date:string>", "Target date (YYYY-MM-DD)")
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const content = options.description ?? await readStdin()

    // Resolve status enum
    let status: InitiativeStatus | undefined
    if (options.status) {
      const statusMap: Record<string, InitiativeStatus> = {
        planned: InitiativeStatus.Planned,
        active: InitiativeStatus.Active,
        completed: InitiativeStatus.Completed,
      }
      status = statusMap[options.status.toLowerCase()]
      if (!status) {
        throw new CliError(
          `invalid status "${options.status}"`,
          4,
          "use: planned, active, completed",
        )
      }
    }

    const ownerId = options.owner
      ? await resolveUser(client, options.owner)
      : undefined

    const payload = await client.createInitiative({
      name: options.name,
      ...(content && { description: content }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(status && { status }),
      ...(ownerId && { ownerId }),
    })
    const initiative = await payload.initiative

    if (!initiative) {
      throw new CliError("failed to create initiative", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: initiative.id,
        entity: "initiative",
        action: "create",
        status: "success",
        url: initiative.url,
        metadata: { name: initiative.name },
      }),
    })
  })

const updateCommand = new Command()
  .description("Update initiative")
  .example(
    "Update status",
    "linear initiative update 'Q1 Goals' --status completed",
  )
  .arguments("<name:string>")
  .option("--name <name:string>", "New name")
  .option("-d, --description <desc:string>", "New description")
  .option("--owner <name:string>", "New owner")
  .option(
    "-s, --status <status:string>",
    "New status: planned, active, completed",
  )
  .option("--target-date <date:string>", "New target date (YYYY-MM-DD)")
  .action(async (options, currentName: string) => {
    const { format, client } = await getCommandContext(options)

    const initiative = await resolveInitiative(client, currentName)

    let status: InitiativeStatus | undefined
    if (options.status) {
      const statusMap: Record<string, InitiativeStatus> = {
        planned: InitiativeStatus.Planned,
        active: InitiativeStatus.Active,
        completed: InitiativeStatus.Completed,
      }
      status = statusMap[options.status.toLowerCase()]
      if (!status) {
        throw new CliError(
          `invalid status "${options.status}"`,
          4,
          "use: planned, active, completed",
        )
      }
    }

    const ownerId = options.owner
      ? await resolveUser(client, options.owner)
      : undefined

    await client.updateInitiative(initiative.id, {
      ...(options.name && { name: options.name }),
      ...(options.description && { description: options.description }),
      ...(options.targetDate && { targetDate: options.targetDate }),
      ...(status && { status }),
      ...(ownerId && { ownerId }),
    })

    // Re-fetch and display updated initiative
    const updated = await client.initiative(initiative.id)
    const updatedOwner = await updated.owner

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: updated.id,
        entity: "initiative",
        action: "update",
        status: "success",
        url: updated.url,
        metadata: {
          name: updated.name,
          status: updated.status,
          owner: updatedOwner?.name ?? null,
          targetDate: updated.targetDate ?? null,
        },
      }),
    })
  })

// --- Porcelain: state transitions ---

const startCommand = new Command()
  .description("Start initiative (set status to active)")
  .example("Start an initiative", "linear initiative start 'Q1 Goals'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const initiative = await resolveInitiative(client, name)
    await client.updateInitiative(initiative.id, {
      status: InitiativeStatus.Active,
    })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: initiative.id,
        entity: "initiative",
        action: "start",
        status: "success",
        url: initiative.url,
        metadata: { name: initiative.name },
      }),
    })
  })

const completeInitiativeCommand = new Command()
  .description("Complete initiative (set status to completed)")
  .example("Complete an initiative", "linear initiative complete 'Q1 Goals'")
  .arguments("<name:string>")
  .action(async (options, name: string) => {
    const { format, client } = await getCommandContext(options)
    const initiative = await resolveInitiative(client, name)
    await client.updateInitiative(initiative.id, {
      status: InitiativeStatus.Completed,
    })
    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: initiative.id,
        entity: "initiative",
        action: "complete",
        status: "success",
        url: initiative.url,
        metadata: { name: initiative.name },
      }),
    })
  })

export const initiativeCommand = new Command()
  .description("Manage initiatives")
  .alias("initiatives")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("start", startCommand)
  .command("complete", completeInitiativeCommand)
