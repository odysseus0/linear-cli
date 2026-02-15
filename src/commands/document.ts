import { Command } from "@cliffy/command"
import { CliError } from "../errors.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { readStdin, resolveDocument, resolveProject } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"
import { getCommandContext } from "./_shared/context.ts"

const listCommand = new Command()
  .description("List documents")
  .example("List all documents", "linear document list")
  .example("Filter by project", "linear document list --project 'My Project'")
  .option("--project <name:string>", "Filter by project name")
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined

    const docs = await client.documents({
      ...(projectId && { filter: { project: { id: { eq: projectId } } } }),
    })
    const items = docs.nodes

    const rows = await Promise.all(
      items.map(async (d) => {
        const creator = await d.creator
        const project = await d.project
        return {
          title: d.title,
          project: project?.name ?? "-",
          creator: creator?.name ?? "-",
          updatedAt: d.updatedAt,
        }
      }),
    )

    if (format === "json") {
      renderJson(rows)
      return
    }

    render(format, {
      headers: ["Title", "Project", "Creator", "Updated"],
      rows: rows.map((r) => [
        r.title,
        r.project,
        r.creator,
        relativeTime(r.updatedAt),
      ]),
    })
  })

const viewCommand = new Command()
  .alias("show")
  .description("View document")
  .example("View a document", "linear document view 'Design Spec'")
  .arguments("<title-or-id:string>")
  .action(async (options, titleOrId: string) => {
    const { format, client } = await getCommandContext(options)

    const doc = await resolveDocument(client, titleOrId)

    const creator = await doc.creator
    const project = await doc.project
    const payload = {
      id: doc.id,
      title: doc.title,
      content: doc.content ?? "",
      project: project?.name ?? null,
      creator: creator?.name ?? null,
      url: doc.url,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }

    if (format === "json") {
      renderJson(payload)
      return
    }

    if (format === "compact") {
      const lines = [
        `title\t${payload.title}`,
        `project\t${payload.project ?? "-"}`,
        `creator\t${payload.creator ?? "-"}`,
        `url\t${payload.url}`,
      ]
      renderMessage(format, lines.join("\n"))
      if (payload.content) {
        renderMessage(format, `\n${payload.content}`)
      }
      return
    }

    render("table", {
      title: payload.title,
      fields: [
        { label: "Project", value: payload.project ?? "-" },
        { label: "Creator", value: payload.creator ?? "-" },
        {
          label: "Created",
          value: `${formatDate(payload.createdAt)} (${
            relativeTime(payload.createdAt)
          })`,
        },
        {
          label: "Updated",
          value: `${formatDate(payload.updatedAt)} (${
            relativeTime(payload.updatedAt)
          })`,
        },
        { label: "URL", value: payload.url },
      ],
    })

    if (payload.content) {
      renderMessage(format, `\n${payload.content}`)
    }
  })

const createCommand = new Command()
  .description("Create document")
  .example(
    "Create a document",
    "linear document create --title 'Design Spec' --project 'My Project'",
  )
  .option("--title <title:string>", "Document title", { required: true })
  .option("--project <name:string>", "Associated project")
  .action(async (options) => {
    const { format, client } = await getCommandContext(options)

    const content = await readStdin()
    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined

    const payload = await client.createDocument({
      title: options.title,
      ...(content && { content }),
      ...(projectId && { projectId }),
    })
    const doc = await payload.document

    if (!doc) {
      throw new CliError("failed to create document", 1)
    }

    const result = { title: doc.title, url: doc.url }
    if (format === "json") {
      renderJson(result)
      return
    }

    renderMessage(format, `Created document: ${result.title}\n${result.url}`)
  })

export const documentCommand = new Command()
  .description("Manage documents")
  .alias("documents").alias("doc").alias("docs")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
