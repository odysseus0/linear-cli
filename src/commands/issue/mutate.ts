import { Command } from "@cliffy/command"
import { CliError } from "../../errors.ts"
import { renderMessage } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import {
  readStdin,
  resolveIssue,
  resolveLabel,
  resolvePriority,
  resolveProject,
  resolveState,
  resolveTeamId,
  resolveUser,
} from "../../resolve.ts"
import { confirmDangerousAction } from "../_shared/confirm.ts"
import { getCommandContext } from "../_shared/context.ts"
import {
  buildMutationResult,
  renderMutationOutput,
} from "../_shared/mutation_output.ts"
import { renderTableHint } from "../_shared/streams.ts"
import { priorityName } from "./shared.ts"

export const createCommand = new Command()
  .description("Create issue")
  .example(
    "Create a bug",
    "linear issue create --team POL --title 'Login crash' --priority urgent --label bug",
  )
  .example(
    "Create and assign to me",
    "linear issue create --team POL --title 'Fix tests' --assignee me",
  )
  .option("--title <title:string>", "Issue title", { required: true })
  .option("-d, --description <desc:string>", "Description")
  .option("-a, --assignee <name:string>", "Assignee name or 'me'")
  .option("-s, --state <state:string>", "Initial state name")
  .option("--status <state:string>", "Alias for --state", { hidden: true })
  .option(
    "--priority <priority:string>",
    "Priority: urgent, high, medium, low, none (or 0-4)",
  )
  .option("-l, --label <name:string>", "Label name", { collect: true })
  .option("--type <type:string>", "Alias for --label", { hidden: true })
  .option("-p, --project <name:string>", "Project name")
  .option("--parent <id:string>", "Parent issue identifier")
  .action(async (options) => {
    const { format, client, teamKey } = await getCommandContext(options, {
      requireTeam: true,
    })
    const teamId = await resolveTeamId(client, teamKey)

    const description = options.description ?? (await readStdin())
    const stateName = options.state ?? options.status
    const assigneeId = options.assignee
      ? await resolveUser(client, options.assignee)
      : undefined
    const stateId = stateName
      ? await resolveState(client, teamId, stateName)
      : undefined
    const labelNames = options.label?.length
      ? options.label
      : options.type
      ? [options.type]
      : undefined
    const labelIds = labelNames?.length
      ? await Promise.all(
        labelNames.map((l: string) => resolveLabel(client, teamId, l)),
      )
      : undefined
    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined
    const parentId = options.parent
      ? (await resolveIssue(client, options.parent, teamKey)).id
      : undefined

    const payload = await client.createIssue({
      teamId,
      title: options.title,
      ...(description && { description }),
      ...(options.priority && { priority: resolvePriority(options.priority) }),
      ...(assigneeId && { assigneeId }),
      ...(stateId && { stateId }),
      ...(labelIds && { labelIds }),
      ...(projectId && { projectId }),
      ...(parentId && { parentId }),
    })
    const issue = await payload.issue

    if (!issue) {
      throw new CliError("failed to create issue", 1)
    }

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: issue.identifier,
        entity: "issue",
        action: "create",
        status: "success",
        url: issue.url,
        metadata: { title: issue.title },
      }),
    })
    renderTableHint(format, `  assign: linear issue assign ${issue.identifier}`)
  })

export const updateCommand = new Command()
  .description("Update issue")
  .example("Change priority", "linear issue update POL-5 --priority high")
  .example("Add a label", "linear issue update POL-5 --add-label bug")
  .arguments("<id:string>")
  .option("--title <title:string>", "New title")
  .option("-d, --description <desc:string>", "New description")
  .option("-a, --assignee <name:string>", "New assignee (empty to unassign)")
  .option("-s, --state <state:string>", "New state name")
  .option("--status <state:string>", "Alias for --state", { hidden: true })
  .option(
    "--priority <priority:string>",
    "Priority: urgent, high, medium, low, none (or 0-4)",
  )
  .option("-l, --label <name:string>", "Replace all labels", { collect: true })
  .option("--add-label <name:string>", "Add label", { collect: true })
  .option("--remove-label <name:string>", "Remove label", { collect: true })
  .option("-p, --project <name:string>", "Move to project")
  .option("--parent <id:string>", "Set parent issue")
  .action(async (options, id: string) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const issue = await resolveIssue(client, id, teamKey)
    const description = options.description ?? (await readStdin())

    const assigneeId = options.assignee !== undefined
      ? (options.assignee === ""
        ? null
        : await resolveUser(client, options.assignee))
      : undefined

    const stateName = options.state ?? options.status
    let stateId: string | undefined
    if (stateName) {
      const state = await issue.state
      const team = await state?.team
      if (team?.id) {
        stateId = await resolveState(client, team.id, stateName)
      }
    }

    let labelIds: string[] | undefined
    const issueTeamId = async () => {
      const state = await issue.state
      const team = await state?.team
      return team?.id ?? ""
    }
    if (options.label?.length) {
      const tid = await issueTeamId()
      labelIds = await Promise.all(
        options.label.map((l: string) => resolveLabel(client, tid, l)),
      )
    } else if (options.addLabel?.length || options.removeLabel?.length) {
      const currentLabels = await issue.labels()
      const currentIds = currentLabels.nodes.map((l: { id: string }) => l.id)
      const tid = await issueTeamId()
      let ids = [...currentIds]
      if (options.addLabel?.length) {
        const addIds = await Promise.all(
          options.addLabel.map((l: string) => resolveLabel(client, tid, l)),
        )
        ids = [...new Set([...ids, ...addIds])]
      }
      if (options.removeLabel?.length) {
        const removeIds = await Promise.all(
          options.removeLabel.map((l: string) => resolveLabel(client, tid, l)),
        )
        ids = ids.filter((id) => !removeIds.includes(id))
      }
      labelIds = ids
    }

    const projectId = options.project
      ? await resolveProject(client, options.project)
      : undefined
    const parentId = options.parent
      ? (await resolveIssue(client, options.parent, teamKey)).id
      : undefined

    await client.updateIssue(issue.id, {
      ...(options.title && { title: options.title }),
      ...(description !== undefined && { description }),
      ...(options.priority && { priority: resolvePriority(options.priority) }),
      ...(assigneeId !== undefined && { assigneeId }),
      ...(stateId && { stateId }),
      ...(labelIds && { labelIds }),
      ...(projectId && { projectId }),
      ...(parentId && { parentId }),
    })

    const updated = await client.issue(issue.id)
    const updatedState = await updated.state
    const updatedAssignee = await updated.assignee
    const updatedDelegate = await updated.delegate

    renderMutationOutput({
      format,
      result: buildMutationResult({
        id: updated.identifier,
        entity: "issue",
        action: "update",
        status: "success",
        url: updated.url,
        metadata: {
          title: updated.title,
          state: updatedState?.name ?? "-",
          priority: priorityName(updated.priority),
          assignee: updatedAssignee?.name ?? null,
          delegate: updatedDelegate?.name ?? null,
        },
      }),
    })
  })

export const deleteCommand = new Command()
  .description("Delete (archive) issue")
  .example("Delete an issue", "linear issue delete POL-5")
  .example("Delete multiple issues", "linear issue delete POL-1 POL-2 POL-3")
  .arguments("<ids...:string>")
  .example("Delete without confirmation", "linear issue delete POL-5 --yes")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client, noInput } = await getCommandContext(options)
    const teamKey = (options as { team?: string }).team

    const issues = await Promise.all(
      ids.map((id) => resolveIssue(client, id, teamKey)),
    )
    const label = issues.length === 1
      ? `${issues[0].identifier} "${issues[0].title}"`
      : `${issues.length} issues (${
        issues.map((issue) => issue.identifier).join(", ")
      })`
    const confirmed = await confirmDangerousAction({
      prompt: `Delete ${label}?`,
      skipConfirm: Boolean((options as { yes?: boolean }).yes) || noInput,
    })
    if (!confirmed) {
      renderMessage(format, "Canceled")
      return
    }

    await Promise.all(issues.map((issue) => client.archiveIssue(issue.id)))

    const payload = issues.map((issue) => ({
      id: issue.identifier,
      status: "success",
      url: issue.url,
      metadata: { title: issue.title },
    }))
    if (format === "json") {
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of issues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "delete",
          status: "success",
          url: issue.url,
          metadata: { title: issue.title },
        }),
      })
    }
  })

export const closeCommand = new Command()
  .alias("done")
  .alias("finish")
  .alias("complete")
  .alias("resolve")
  .description("Close issue (set to completed state)")
  .example("Close an issue", "linear issue close POL-5")
  .example("Close multiple issues", "linear issue close POL-1 POL-2 POL-3")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const completedStateByTeam = new Map<string, { id: string; name: string }>()
    const closedIssues: Array<
      { identifier: string; url: string; state: string }
    > = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let completed = completedStateByTeam.get(team.id)
      if (!completed) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "completed")
        if (!stateNode) {
          throw new CliError(
            "no completed state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        completed = { id: stateNode.id, name: stateNode.name }
        completedStateByTeam.set(team.id, completed)
      }

      await client.updateIssue(issue.id, { stateId: completed.id })
      closedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: completed.name,
      })
    }

    if (format === "json") {
      const payload = closedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of closedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "close",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

export const reopenCommand = new Command()
  .alias("open")
  .description("Reopen issue (set to unstarted state)")
  .example("Reopen an issue", "linear issue reopen POL-5")
  .example("Reopen multiple issues", "linear issue reopen POL-1 POL-2")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const unstartedStateByTeam = new Map<string, { id: string; name: string }>()
    const reopenedIssues: Array<
      { identifier: string; url: string; state: string }
    > = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let unstarted = unstartedStateByTeam.get(team.id)
      if (!unstarted) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "unstarted")
        if (!stateNode) {
          throw new CliError(
            "no unstarted state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        unstarted = { id: stateNode.id, name: stateNode.name }
        unstartedStateByTeam.set(team.id, unstarted)
      }

      await client.updateIssue(issue.id, { stateId: unstarted.id })
      reopenedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: unstarted.name,
      })
      renderTableHint(
        format,
        `  assign: linear issue assign ${issue.identifier}`,
      )
    }

    if (format === "json") {
      const payload = reopenedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of reopenedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "reopen",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

export const startCommand = new Command()
  .alias("begin")
  .description("Start issue (set to in-progress state)")
  .example("Start working on issue", "linear issue start POL-5")
  .example("Start multiple issues", "linear issue start POL-1 POL-2")
  .arguments("<ids...:string>")
  .action(async (options, ...ids: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as unknown as { team?: string }).team

    const startedStateByTeam = new Map<string, { id: string; name: string }>()
    const startedIssues: Array<
      { identifier: string; url: string; state: string }
    > = []

    for (const id of ids) {
      const issue = await resolveIssue(client, id, teamKey)
      const state = await issue.state
      const team = await state?.team
      if (!team) throw new CliError("cannot determine team for issue", 1)

      let started = startedStateByTeam.get(team.id)
      if (!started) {
        const states = await team.states()
        const stateNode = states.nodes.find((s) => s.type === "started")
        if (!stateNode) {
          throw new CliError(
            "no started state found for team",
            1,
            "check team workflow settings in Linear",
          )
        }
        started = { id: stateNode.id, name: stateNode.name }
        startedStateByTeam.set(team.id, started)
      }

      await client.updateIssue(issue.id, { stateId: started.id })
      startedIssues.push({
        identifier: issue.identifier,
        url: issue.url,
        state: started.name,
      })
      renderTableHint(
        format,
        `  close when done: linear issue close ${issue.identifier}`,
      )
    }

    if (format === "json") {
      const payload = startedIssues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { state: issue.state },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of startedIssues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "start",
          status: "success",
          url: issue.url,
          metadata: { state: issue.state },
        }),
      })
    }
  })

export const assignCommand = new Command()
  .description("Assign issue to user (defaults to me)")
  .example("Assign to me", "linear issue assign POL-5")
  .example("Assign to someone", "linear issue assign POL-5 'Jane Smith'")
  .example(
    "Assign multiple issues",
    "linear issue assign POL-1 POL-2 --user 'Jane Smith'",
  )
  .arguments("<targets...:string>")
  .option("-u, --user <user:string>", "Assignee (defaults to me)")
  .action(async (options, ...targets: [string, ...Array<string>]) => {
    const { format, client } = await getCommandContext(options)
    const teamKey = (options as { team?: string }).team

    const ids = [...targets]
    let assigneeName = (options as { user?: string }).user

    if (
      !assigneeName &&
      ids.length > 1 &&
      !/^[A-Za-z0-9]+-\d+$/.test(ids[ids.length - 1])
    ) {
      assigneeName = ids.pop()
    }

    if (ids.length === 0) {
      throw new CliError(
        "at least one issue id is required",
        4,
        "issue assign POL-1 [POL-2 ...] [--user <name>]",
      )
    }

    assigneeName = assigneeName ?? "me"
    const assigneeId = await resolveUser(client, assigneeName)
    const issues = await Promise.all(
      ids.map((id) => resolveIssue(client, id, teamKey)),
    )
    await Promise.all(
      issues.map((issue) => client.updateIssue(issue.id, { assigneeId })),
    )

    let displayName: string
    if (assigneeName === "me") {
      displayName = (await client.viewer).name
    } else {
      const updated = await client.issue(issues[0].id)
      const assignee = await updated.assignee
      displayName = assignee?.name ?? assigneeName
    }

    if (format === "json") {
      const payload = issues.map((issue) => ({
        id: issue.identifier,
        status: "success",
        url: issue.url,
        metadata: { assignee: displayName },
      }))
      renderJson(payload.length === 1 ? payload[0] : payload)
      return
    }

    for (const issue of issues) {
      renderMutationOutput({
        format,
        result: buildMutationResult({
          id: issue.identifier,
          entity: "issue",
          action: "assign",
          status: "success",
          url: issue.url,
          metadata: { assignee: displayName },
        }),
      })
      renderTableHint(format, `  start: linear issue start ${issue.identifier}`)
    }
  })
