import { type Format, normalizeFormat } from "./output/formatter.ts"

export interface GlobalOptions {
  format?: string
  team?: string
  json?: boolean
  noInput?: boolean
}

/** Extract format from Cliffy's untyped options. Single cast, one place. */
export function getFormat(options: unknown): Format {
  const opts = options as GlobalOptions
  if (opts.json) return "json"
  return normalizeFormat(opts.format)
}
