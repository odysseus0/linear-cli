import type { Format } from "../../output/formatter.ts"
import { renderMessage } from "../../output/formatter.ts"

const encoder = new TextEncoder()

function writeStderr(text: string): void {
  Deno.stderr.writeSync(encoder.encode(text))
}

export function renderOutputMessage(format: Format, message: string): void {
  renderMessage(format, message)
}

export function renderStderrMessage(format: Format, message: string): void {
  if (format === "json") return
  writeStderr(`${message}\n`)
}

export function renderTableHint(format: Format, message: string): void {
  if (format !== "table") return
  writeStderr(`${message}\n`)
}

export function renderTableProgress(format: Format, message: string): void {
  if (format !== "table") return
  writeStderr(`${message}\r`)
}
