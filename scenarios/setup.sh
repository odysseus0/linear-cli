#!/usr/bin/env bash
# Create test issues for agent usability scenarios.
# Outputs issue IDs as KEY=VALUE pairs for the orchestrator.
set -euo pipefail

CLI="deno run --allow-all /Users/tengjizhang/projects/linear-cli/src/main.ts"

# Extract issue ID (e.g., "POL-12") from "Created POL-12: ..." (first line only)
extract_id() { echo "$1" | head -1 | grep -oE '[A-Z]+-[0-9]+'; }

echo "=== Agent Usability Test Setup ==="

out=$($CLI issue create --team POL --title '[AGENT-TEST] Close me' --priority medium)
CLOSE_ISSUE=$(extract_id "$out")
echo "CLOSE_ISSUE=$CLOSE_ISSUE"

out=$($CLI issue create --team POL --title '[AGENT-TEST] Assign me')
ASSIGN_ISSUE=$(extract_id "$out")
echo "ASSIGN_ISSUE=$ASSIGN_ISSUE"

out=$($CLI issue create --team POL --title '[AGENT-TEST] Comment target')
COMMENT_ISSUE=$(extract_id "$out")
echo "COMMENT_ISSUE=$COMMENT_ISSUE"

out=$($CLI issue create --team POL --title '[AGENT-TEST] Reprioritize' --priority high)
PRIORITY_ISSUE=$(extract_id "$out")
echo "PRIORITY_ISSUE=$PRIORITY_ISSUE"

echo ""
echo "Setup complete. 4 issues created."
