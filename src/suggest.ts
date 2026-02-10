// deno-lint-ignore-file no-explicit-any
import type { Command } from "@cliffy/command"

/** Compute Levenshtein distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  )

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],
          dp[i][j - 1],
          dp[i - 1][j - 1],
        )
      }
    }
  }

  return dp[m][n]
}

interface CommandEntry {
  /** Full path, e.g. "issue comment" */
  path: string
  /** Leaf name, e.g. "comment" */
  name: string
}

/** Walk a cliffy command tree and collect all [path, name] pairs. */
export function buildIndex(root: Command<any>): CommandEntry[] {
  const entries: CommandEntry[] = []

  function walk(cmd: Command, prefix: string) {
    for (const sub of cmd.getCommands(false)) {
      const name = sub.getName()
      const path = prefix ? `${prefix} ${name}` : name
      entries.push({ path, name })
      walk(sub, path)
    }
  }

  walk(root, "")
  return entries
}

/**
 * Suggest commands for an unknown input (Cobra-style).
 *
 * 1. Levenshtein on top-level names (typo correction)
 * 2. Exact subcommand name match across the full tree (misplaced commands)
 * 3. Levenshtein on subcommand names across the full tree
 * 4. Fallback: empty (caller should list available commands)
 */
export function suggestCommand(
  input: string,
  index: CommandEntry[],
  topLevel: string[],
): string[] {
  const lower = input.toLowerCase()

  // 1. Levenshtein on top-level command names (handles typos like "isue" → "issue")
  const topMatches: { name: string; d: number }[] = []
  for (const name of topLevel) {
    const d = levenshtein(lower, name.toLowerCase())
    if (d <= 2 && d < name.length) {
      topMatches.push({ name, d })
    }
  }
  if (topMatches.length) {
    topMatches.sort((a, b) => a.d - b.d)
    return topMatches.map((m) => m.name)
  }

  // 2. Exact subcommand name match in the full tree
  const exact = index
    .filter((e) => e.name.toLowerCase() === lower)
    .map((e) => e.path)
  if (exact.length) return [...new Set(exact)]

  // 3. Levenshtein on all subcommand names (threshold ≤ 2)
  const scored: { path: string; d: number }[] = []
  for (const entry of index) {
    const d = levenshtein(lower, entry.name.toLowerCase())
    if (d <= 2 && d < entry.name.length) {
      scored.push({ path: entry.path, d })
    }
  }
  if (scored.length) {
    scored.sort((a, b) => a.d - b.d)
    const seen = new Set<string>()
    return scored
      .filter((s) => {
        if (seen.has(s.path)) return false
        seen.add(s.path)
        return true
      })
      .slice(0, 3)
      .map((s) => s.path)
  }

  return []
}
