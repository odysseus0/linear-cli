import { Command } from "@cliffy/command"
import { createClient } from "../client.ts"
import { getAPIKey } from "../auth.ts"
import { CliError } from "../errors.ts"
import { getFormat } from "../types.ts"
import { render } from "../output/formatter.ts"
import { renderJson } from "../output/json.ts"

export const userCommand = new Command()
  .description("Manage users")
  .alias("users")
  .command(
    "list",
    new Command()
      .description("List workspace users")
      .action(async (options) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const client = createClient(apiKey)
        const usersConnection = await client.users()
        const users = usersConnection.nodes

        if (format === "json") {
          renderJson(
            users.map((u) => ({
              name: u.name,
              displayName: u.displayName,
              email: u.email,
              admin: u.admin ?? false,
              active: u.active ?? true,
            })),
          )
          return
        }

        render(format, {
          headers: ["Name", "Email", "Admin", "Active"],
          rows: users.map((u) => [
            u.name ?? "Unknown",
            u.email ?? "-",
            u.admin ? "yes" : "no",
            u.active ? "yes" : "no",
          ]),
        })
      }),
  )
  .command(
    "view",
    new Command()
      .alias("show")
      .description("View user details")
      .arguments("<name:string>")
      .action(async (options, name: string) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const client = createClient(apiKey)

        let user

        if (name === "me") {
          user = await client.viewer
        } else {
          const usersConnection = await client.users()
          const all = usersConnection.nodes

          // Exact name match (case-insensitive)
          let found = all.find(
            (u) => u.name.toLowerCase() === name.toLowerCase(),
          )
          // Exact email match
          if (!found) {
            found = all.find(
              (u) => u.email?.toLowerCase() === name.toLowerCase(),
            )
          }
          // Substring match
          if (!found) {
            const partial = all.filter(
              (u) => u.name.toLowerCase().includes(name.toLowerCase()),
            )
            if (partial.length === 1) {
              found = partial[0]
            } else if (partial.length > 1) {
              const candidates = partial
                .map((u) => `${u.name} (${u.email})`)
                .join(", ")
              throw new CliError(
                `ambiguous user "${name}"`,
                4,
                `matches: ${candidates}`,
              )
            }
          }
          if (!found) {
            const available = all
              .map((u) => `${u.name} (${u.email})`)
              .join(", ")
            throw new CliError(
              `user not found: "${name}"`,
              3,
              `available: ${available}`,
            )
          }
          user = found
        }

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
  .command(
    "me",
    new Command()
      .description("Show current authenticated user")
      .action(async (options) => {
        const format = getFormat(options)
        const apiKey = await getAPIKey()
        const client = createClient(apiKey)

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
