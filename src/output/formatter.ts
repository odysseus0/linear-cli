import { renderJson } from "./json.ts"
import { renderTable } from "./table.ts"

export type Format = "table" | "compact" | "json"

export interface TableData {
  headers: string[]
  rows: string[][]
}

export interface DetailData {
  title: string
  fields: { label: string; value: string }[]
}

export type RenderData = TableData | DetailData

export function render(format: Format, data: RenderData): void {
  if (format === "json") {
    renderJson(data)
    return
  }
  renderTable(format, data)
}

export function normalizeFormat(value: string | undefined): Format {
  switch (value) {
    case "table":
    case "compact":
    case "json":
      return value
    default:
      throw new Error(`invalid format: ${value}`)
  }
}

export function renderMessage(format: Format, message: string): void {
  if (format === "json") {
    renderJson({ message })
    return
  }
  console.log(message)
}
