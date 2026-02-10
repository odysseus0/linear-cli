# Agent Usability Test Scenarios

Scenarios test three dimensions:
1. **Happy path** — can an agent accomplish the task on first try?
2. **Discovery** — can an agent find commands without being told the exact syntax?
3. **Workflow** — can an agent chain multiple commands to complete a real task?

---

## close-issue
**Setup:** `issue create --team POL --title '[AGENT-TEST] Close me' --priority medium`
**Task:** Mark issue {id} as done.
**Verify:** Issue state should be "Done".

## create-urgent-bug
**Task:** Create an urgent bug in team POL titled "Login page crashes on mobile".
**Verify:** Issue exists with priority "Urgent".

## assign-and-start
**Setup:** `issue create --team POL --title '[AGENT-TEST] Assign me'`
**Task:** Assign issue {id} to me and mark it as in progress.
**Verify:** Issue has an assignee and state is "In Progress".

## add-comment
**Setup:** `issue create --team POL --title '[AGENT-TEST] Comment target'`
**Task:** Add a comment to issue {id} saying "Investigation complete: root cause is a null pointer in auth middleware".
**Verify:** Issue has a comment containing "null pointer".

## change-priority
**Setup:** `issue create --team POL --title '[AGENT-TEST] Reprioritize' --priority high`
**Task:** Change issue {id} priority to low.
**Verify:** Issue priority is "Low".

## list-team-issues
**Task:** Show me all issues for team POL.
**Verify:** Output contains issue identifiers (POL-X format).

## discover-workflow-states
**Task:** I need to know what workflow states are available before I can triage issues. Figure out the possible states for the POL team.
**Verify:** Output includes state names like "Backlog", "Todo", "In Progress", "Done".

## discover-labels
**Task:** Before I label an issue, I need to see what labels exist. Find the labels for the POL team.
**Verify:** Output includes label names.

## checkout-issue-branch
**Setup:** `issue create --team POL --title '[AGENT-TEST] Branch test'`
**Task:** I want to check out a git branch for issue {id}. Get me the branch name so I can run git checkout.
**Verify:** Output contains a branch name string (no extra formatting — just the name).

## find-users
**Task:** I need to assign an issue but I don't remember the team member's exact name. List everyone in the workspace so I can find them.
**Verify:** Output includes user names and emails.

## whoami
**Task:** Show me my own Linear profile — the currently authenticated user.
**Verify:** Output includes a user name and email.

## user-lookup-by-partial-name
**Task:** Look up the user profile for someone whose name contains "Teng".
**Verify:** Output includes user details, or a clear error if ambiguous/not found.

## update-project-description
**Setup:** `project create --name '[AGENT-TEST] Update target' --team POL`
**Task:** Change the description of the project "[AGENT-TEST] Update target" to "Updated by agent test".
**Verify:** Project view shows description containing "Updated by agent test".

## discover-project-labels
**Task:** What labels are associated with the project "[AGENT-TEST] Update target"?
**Verify:** Command executes without error (may return empty list).

## create-milestone
**Task:** Add a milestone called "Beta launch" with target date 2026-03-15 to the project "[AGENT-TEST] Update target".
**Verify:** Milestone exists on the project.

## post-project-update
**Task:** Post a status update on the project "[AGENT-TEST] Update target" saying "All blockers resolved, on track for launch" with health status "on track".
**Verify:** Project update exists.

## triage-workflow
**Setup:** `issue create --team POL --title '[AGENT-TEST] Triage me'`
**Task:** Triage issue {id}: set priority to high, assign it to me, move it to "In Progress", and add a comment saying "Triaged — starting investigation".
**Verify:** Issue has priority High, has an assignee, state is "In Progress", and has a comment containing "Triaged".

## audit-team-setup
**Task:** Give me a full audit of how the POL team is configured: what members it has, what workflow states are available, and what labels exist. Output everything.
**Verify:** Output includes team members, workflow states, and labels.

## find-my-work
**Task:** Show me all issues currently assigned to me in the POL team.
**Verify:** Output contains issues (or an empty list if none assigned).
