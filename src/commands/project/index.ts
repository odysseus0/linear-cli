import { Command } from "@cliffy/command"
import { milestoneCommand } from "./milestone.ts"
import {
  addIssueCommand,
  createCommand,
  deleteCommand,
  updateCommand,
} from "./mutate.ts"
import { labelsCommand, listCommand, viewCommand } from "./read.ts"
import {
  cancelCommand,
  completeCommand,
  pauseCommand,
  postCommand,
  startCommand,
} from "./status.ts"

export const projectCommand = new Command()
  .description("Manage projects")
  .alias("projects")
  .example("List projects", "linear project list")
  .example("View project", "linear project view 'My Project'")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("milestone", milestoneCommand)
  .command("post", postCommand)
  .command("labels", labelsCommand)
  .command("start", startCommand)
  .command("pause", pauseCommand)
  .command("complete", completeCommand)
  .command("cancel", cancelCommand)
  .command("delete", deleteCommand)
  .command("add-issue", addIssueCommand)
