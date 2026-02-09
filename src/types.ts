import { normalizeFormat, type Format } from "./output/formatter.ts"

export interface GlobalOptions {
  format?: string
  team?: string
}

/** Extract format from Cliffy's untyped options. Single cast, one place. */
export function getFormat(options: unknown): Format {
  return normalizeFormat((options as GlobalOptions).format)
}
