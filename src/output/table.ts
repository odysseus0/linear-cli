import { Table } from "@cliffy/table"
import { bold, cyan } from "@std/fmt/colors"
import type { DetailData, TableData } from "./formatter.ts"
import { renderCompact } from "./compact.ts"

export function renderTable(
  format: "table" | "compact",
  data: TableData | DetailData,
): void {
  if (format === "compact") {
    if ("fields" in data) {
      for (const field of data.fields) {
        console.log(`${field.label.toLowerCase()}\t${field.value}`)
      }
      return
    }
    renderCompact(data as TableData)
    return
  }

  if ("fields" in data) {
    console.log(bold(data.title))
    console.log("━".repeat(data.title.length))
    console.log()
    const maxLabel = Math.max(...data.fields.map((f) => f.label.length))
    for (const field of data.fields) {
      console.log(
        `${field.label + ":"}${
          " ".repeat(maxLabel - field.label.length + 3)
        }${field.value}`,
      )
    }
    return
  }

  const table = new Table()
    .header(data.headers.map((header) => bold(cyan(header))))
    .body(data.rows)
  console.log(table.toString())
}
