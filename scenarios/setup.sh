#!/usr/bin/env bash
# Create test fixtures for agent usability scenarios.
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

out=$($CLI issue create --team POL --title '[AGENT-TEST] Branch test')
BRANCH_ISSUE=$(extract_id "$out")
echo "BRANCH_ISSUE=$BRANCH_ISSUE"

out=$($CLI issue create --team POL --title '[AGENT-TEST] Triage me')
TRIAGE_ISSUE=$(extract_id "$out")
echo "TRIAGE_ISSUE=$TRIAGE_ISSUE"

$CLI project create --name '[AGENT-TEST] Update target' --team POL 2>&1 || echo "WARN: project create failed (may already exist)"
echo "PROJECT_NAME=[AGENT-TEST] Update target"

echo ""
echo "Setup complete. 6 issues + 1 project created."
