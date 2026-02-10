# Agent Usability Test Runner

You are running agent usability tests for linear-cli. The goal: measure whether
a zero-context agent can figure out the CLI from --help and error messages alone.

## Setup

The CLI is at: /Users/tengjizhang/projects/linear-cli/src/main.ts
Run commands with: deno run --allow-all /Users/tengjizhang/projects/linear-cli/src/main.ts [args]

## Procedure

1. Read scenarios/scenarios.md
2. For each scenario:
   a. Run the Setup command (if any) via Bash. Capture the issue ID from output.
   b. Substitute {id} in the Task with the actual issue identifier.
   c. Spawn a Task subagent (type: Bash, model: opus) with this prompt:

      ---
      You have a CLI tool called `linear-cli` for managing Linear issues.
      Run it with: deno run --allow-all /Users/tengjizhang/projects/linear-cli/src/main.ts

      Just try to accomplish the task. Guess commands based on what seems
      natural — like you would with any well-designed CLI. Only fall back
      to --help if your guess fails.

      Your task: {task}

      After completing (or failing), report:
      1. Each command you attempted (exact args after src/main.ts)
      2. Whether each succeeded or errored
      3. If errored, the error message and how you recovered
      ---

      Use max_turns: 5.

   d. Parse the subagent's response for commands attempted and outcomes.
   e. Run the Verify check yourself (e.g., issue view {id} --format json).
   f. Record: scenario name, pass/fail, number of attempts, whether first attempt
      succeeded, whether agent recovered from errors, exact commands tried.

3. Write results to scenarios/report.md as a markdown table.
4. Clean up: list all issues with '[AGENT-TEST]' in title, delete (archive) each.

## Report format

```markdown
# Agent Usability Test Report — {date}

| Scenario | Result | Attempts | First-try | Recovery | Commands |
|----------|--------|----------|-----------|----------|----------|

## Summary
- Total scenarios: N
- Pass: X/N
- First-attempt success rate: Y/N (Z%)
- Mean attempts to success: A
```
