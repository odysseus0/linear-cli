# linctl

Agent-native Linear CLI. Designed for AI agents managing work — orchestrator-first defaults, token-efficient output, name resolution.

## Why

Linear's MCP server returns ~2000 tokens for 6 issues. The existing Deno CLI (`schpet/linear-cli`) defaults to `--assignee me`. Neither is designed for agents managing work.

linctl uses Linear's official SDK for correctness (behavioral contract: null coercion, lazy fetching, pagination) and adds what agents need: compact output (~50 tokens for same 6 issues), orchestrator-first defaults, name resolution.

## Install

```bash
# From source
deno task compile
cp linctl /usr/local/bin/

# Or run directly
deno task dev -- <command>
```

## Quick Start

```bash
# Authenticate
linctl auth login --key lin_api_xxxxx

# List all active issues (all assignees, sorted by updated)
linctl issue list

# Agent-friendly compact output
linctl issue list --format compact

# Team overview — the orchestrator's primary command
linctl team overview
```

## Two Output Modes

**Table** (default, human):
```
◌   ID     STATE    ASSIGNEE  TITLE                   UPDATED
--- POL-6  Backlog  -         Test issue from MCP     1 min ago
!!! POL-1  Todo     Alice     Implement auth module   2 hours ago
```

**Compact** (agent, `--format compact`):
```
ID	STATE	ASSIGNEE	TITLE	UPDATED
POL-6	Backlog	-	Test issue from MCP	1m
POL-1	Todo	Alice	Implement auth module	2h
```

## Stack

Deno / [Cliffy](https://cliffy.io) / [@linear/sdk](https://www.npmjs.com/package/@linear/sdk)

## License

MIT
