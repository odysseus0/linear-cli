# Agent Usability Test Scenarios

## close-issue
**Setup:** `issue create --team POL --title '[AGENT-TEST] Close me' --priority medium`
**Task:** Mark issue {id} as done
**Verify:** Issue state should be "Done"

## create-urgent-bug
**Task:** Create an urgent bug in team POL titled 'Login page crashes on mobile'
**Verify:** Issue exists with priority "Urgent"

## assign-and-start
**Setup:** `issue create --team POL --title '[AGENT-TEST] Assign me'`
**Task:** Assign issue {id} to me and mark it as in progress
**Verify:** Issue has an assignee and state is "In Progress"

## add-comment
**Setup:** `issue create --team POL --title '[AGENT-TEST] Comment target'`
**Task:** Add a comment to issue {id} saying 'Investigation complete: root cause is a null pointer in auth middleware'
**Verify:** Issue has a comment containing "null pointer"

## change-priority
**Setup:** `issue create --team POL --title '[AGENT-TEST] Reprioritize' --priority high`
**Task:** Change issue {id} priority to low
**Verify:** Issue priority is "Low"

## list-team-issues
**Task:** Show me all issues for team POL
**Verify:** Output contains issue identifiers (POL-X format)
