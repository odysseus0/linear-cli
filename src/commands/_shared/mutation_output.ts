import type { Format } from "../../output/formatter.ts"
import { render } from "../../output/formatter.ts"
import { renderJson } from "../../output/json.ts"
import { createCommandResult } from "./output_contract.ts"
import type { CommandResult } from "./output_contract.ts"

export interface MutationData {
  id: string
  status: string
  url?: string
  metadata?: Record<string, unknown>
}

export type MutationResult = CommandResult<MutationData>

export function buildMutationResult(options: {
  entity: string
  action: string
  id: string
  status: string
  url?: string
  metadata?: Record<string, unknown>
}): MutationResult {
  return createCommandResult({
    entity: options.entity,
    action: options.action,
    data: {
      id: options.id,
      status: options.status,
      ...(options.url && { url: options.url }),
      ...(options.metadata && { metadata: options.metadata }),
    },
  })
}

interface RenderMutationOutputOptions {
  format: Format
  result: MutationResult
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

/**
 * Render a mutation result from a single DTO for all output formats.
 */
export function renderMutationOutput(
  options: RenderMutationOutputOptions,
): void {
  if (options.format === "json") {
    renderJson(options.result.data)
    return
  }

  const fields = [
    { label: "OK", value: "true" },
    { label: "Entity", value: options.result.entity },
    { label: "Action", value: options.result.action },
    { label: "ID", value: options.result.data.id },
    { label: "Status", value: options.result.data.status },
  ]
  if (options.result.data.url) {
    fields.push({ label: "URL", value: options.result.data.url })
  }
  if (options.result.data.metadata) {
    fields.push({
      label: "Metadata",
      value: toDisplayValue(options.result.data.metadata),
    })
  }

  render(options.format, {
    title: `${options.result.entity} ${options.result.action}`,
    fields,
  })
}
