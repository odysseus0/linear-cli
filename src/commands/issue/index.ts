import { Command } from "@cliffy/command"
import { commentCommand } from "./comment.ts"
import { branchCommand, listCommand, viewCommand } from "./read.ts"
import {
  assignCommand,
  closeCommand,
  createCommand,
  deleteCommand,
  reopenCommand,
  startCommand,
  updateCommand,
} from "./mutate.ts"
import { watchCommand } from "./watch.ts"

export const issueCommand = new Command()
  .description("Manage issues")
  .alias("issues")
  .example("List issues", "linear issue list --team POL")
  .example("View issue", "linear issue view POL-5")
  .example("Close issue", "linear issue close POL-5")
  .command("list", listCommand)
  .command("view", viewCommand)
  .command("create", createCommand)
  .command("update", updateCommand)
  .command("delete", deleteCommand)
  .command("comment", commentCommand)
  .command("branch", branchCommand)
  .command("close", closeCommand)
  .command("reopen", reopenCommand)
  .command("start", startCommand)
  .command("assign", assignCommand)
  .command("watch", watchCommand)

export { fetchIssueAgentSessions, getLatestSession } from "./shared.ts"
