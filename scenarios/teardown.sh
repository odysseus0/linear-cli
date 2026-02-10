#!/usr/bin/env bash
# Delete all [AGENT-TEST] issues and any agent-created test issues.
# Catches both setup issues and issues created by agent scenarios.
set -euo pipefail

CLI="deno run --allow-all /Users/tengjizhang/projects/linear-cli/src/main.ts"

echo "=== Agent Usability Test Teardown ==="

# List all POL issues (JSON array), filter for test artifacts
ids=$($CLI issue list --team POL --include-completed --format json 2>/dev/null \
  | deno eval --ext=ts '
    const data = JSON.parse(await new Response(Deno.stdin.readable).text());
    for (const i of data) {
      if (i.title?.includes("[AGENT-TEST]") || i.title === "Login page crashes on mobile") {
        console.log(i.identifier);
      }
    }
  ' 2>/dev/null) || true

if [ -z "$ids" ]; then
  echo "No test issues found."
  exit 0
fi

count=0
for id in $ids; do
  $CLI issue delete "$id" 2>&1
  count=$((count + 1))
done

echo ""
echo "Teardown: $count issues deleted."

# Also clean up test projects
echo "Cleaning up test projects..."
$CLI project list --format json 2>/dev/null \
  | deno eval --ext=ts '
    const data = JSON.parse(await new Response(Deno.stdin.readable).text());
    for (const p of data) {
      if (p.name?.includes("[AGENT-TEST]")) {
        console.log(p.name);
      }
    }
  ' 2>/dev/null || true

echo "Teardown complete."
