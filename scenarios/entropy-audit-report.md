# Entropy Audit Update

Date: 2026-02-15 Branch: `codex/entropy-reduction`

## Finding Status

1. Shared command-context adoption: **closed**
2. Resolver/enum duplication: **closed**
3. Direct handler console usage: **closed**
4. Monolithic command layout (`issue` / `project`): **closed**
5. Scale assumptions (`agentSessions`, team overview, project preview):
   **closed**
6. Guardrails and CI gates: **closed**

## Notes

- Command concerns are now split and routed through directory indexes:
  - `src/commands/issue/index.ts` + `read.ts` + `mutate.ts` + `comment.ts` + `watch.ts` + `shared.ts`
  - `src/commands/project/index.ts` + `read.ts` + `mutate.ts` + `milestone.ts` + `status.ts` + `shared.ts`
  - compatibility shims retained at `src/commands/issue.ts` and `src/commands/project.ts`
- Session and overview paths now cover scale cases:
  - issue sessions fetched via paginated helper in `src/commands/issue/shared.ts`
  - team overview issues paginated beyond 200 in `src/commands/team.ts`
  - project issue preview semantics explicit in `src/commands/project/read.ts`
- Watch output contracts are explicit and tested for `table|compact|json`, including timeout.
- Scenario regression remains intentionally manual (LLM + eyeballing) and out of CI scope.

## Next Backlog

1. Optional: server-side filtering for issue sessions if/when SDK/API exposes issue-scoped `agentSessions` filters.
2. Optional: broader integration coverage for long-running watch polling in end-to-end harnesses.
