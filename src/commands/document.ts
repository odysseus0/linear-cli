import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { CliError } from "../errors.ts"
import { getAPIKey } from "../auth.ts"
import { getFormat } from "../types.ts"
import { render, renderMessage } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"
import { readStdin, resolveDocument, resolveProject } from "../resolve.ts"
import { formatDate, relativeTime } from "../time.ts"

const listCommand = new Command()
  .description("List documents")
  .example("List all documents", "linear document list")
  .example("Filter by project", "linear document list --project 'My Project'")
  .option("--project <name:string>", "Filter by project name")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    // Build filter if --project specified
    // deno-lint-ignore no-explicit-any
    const variables: any = {}
    if (options.project) {
      const projectId = await resolveProject(client, options.project)
      variables.filter = { project: { id: { eq: projectId } } }
    }

    const docs = await client.documents(variables)
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
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const doc = await resolveDocument(client, titleOrId)

    const creator = await doc.creator
    const project = await doc.project

    if (format === "json") {
      renderJson({
        id: doc.id,
        title: doc.title,
        content: doc.content ?? "",
        project: project?.name ?? null,
        creator: creator?.name ?? null,
        url: doc.url,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })
      return
    }

    if (format === "compact") {
      const lines = [
        `title\t${doc.title}`,
        `project\t${project?.name ?? "-"}`,
        `creator\t${creator?.name ?? "-"}`,
        `url\t${doc.url}`,
      ]
      console.log(lines.join("\n"))
      if (doc.content) {
        console.log(`\n${doc.content}`)
      }
      return
    }

    render("table", {
      title: doc.title,
      fields: [
        { label: "Project", value: project?.name ?? "-" },
        { label: "Creator", value: creator?.name ?? "-" },
        {
          label: "Created",
          value: `${formatDate(doc.createdAt)} (${
            relativeTime(doc.createdAt)
          })`,
        },
        {
          label: "Updated",
          value: `${formatDate(doc.updatedAt)} (${
            relativeTime(doc.updatedAt)
          })`,
        },
        { label: "URL", value: doc.url },
      ],
    })

    if (doc.content) {
      console.log(`\n${doc.content}`)
    }
  })

const createCommand = new Command()
  .description("Create document")
  .example("Create a document", "linear document create --title 'Design Spec' --project 'My Project'")
  .option("--title <title:string>", "Document title", { required: true })
  .option("--project <name:string>", "Associated project")
  .action(async (options) => {
    const format = getFormat(options)
    const apiKey = await getAPIKey()
    const client = createClient(apiKey)

    const content = await readStdin()

    // deno-lint-ignore no-explicit-any
    const input: any = {
      title: options.title,
    }

    if (content) input.content = content

    if (options.project) {
      input.projectId = await resolveProject(client, options.project)
    }

    const payload = await client.createDocument(input)
    const doc = await payload.document

    if (!doc) {
      throw new CliError("failed to create document", 1)
    }

    if (format === "json") {
      renderJson({ title: doc.title, url: doc.url })
      return
    }

    renderMessage(format, `Created document: ${doc.title}\n${doc.url}`)
  })

export const documentCommand = new Command()
  .description("Manage documents")
  .alias("documents").alias("doc").alias("docs")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
