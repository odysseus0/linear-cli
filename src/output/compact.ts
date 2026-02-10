import type { TableData } from "./formatter.ts"

export function renderCompact(data: TableData): void {
  const headerLine = data.headers.map((header) => header.toUpperCase()).join(
    "\t",
  )
  const rows = data.rows.map((row) => row.join("\t"))
  console.log([headerLine, ...rows].join("\n"))
}
