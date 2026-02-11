import { bold, dim, italic, cyan } from "@std/fmt/colors"

// ── Public API ──────────────────────────────────────────────────

export interface RenderOptions {
  /** Prefix for every line (default: none) */
  indent?: string
  /** Terminal width for word wrapping (default: auto-detected) */
  width?: number
}

/**
 * Render markdown for terminal display.
 * Formats inline syntax (bold, code, links, bullets) and word-wraps
 * to fit the terminal. Commands call this — they don't need to know
 * about ANSI widths or wrapping mechanics.
 */
export function renderMarkdown(text: string, opts: RenderOptions = {}): string {
  const indent = opts.indent ?? ""
  const width = opts.width ?? terminalWidth()
  return wrapAnsi(formatMarkdown(text), indent, width)
}

/**
 * Word-wrap plain or ANSI-formatted text for terminal display.
 * Use for non-markdown text that still needs indentation and wrapping.
 */
export function wrapText(text: string, opts: RenderOptions = {}): string {
  const indent = opts.indent ?? ""
  const width = opts.width ?? terminalWidth()
  return wrapAnsi(text, indent, width)
}

/** Current terminal width, with fallback. */
export function terminalWidth(): number {
  try {
    if (Deno.stdout.isTerminal()) {
      return Deno.consoleSize().columns
    }
  } catch { /* non-terminal or permission denied */ }
  return 80
}

// ── Markdown formatting ─────────────────────────────────────────

function formatMarkdown(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let inCodeBlock = false

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock
      out.push(dim("─".repeat(40)))
      continue
    }

    if (inCodeBlock) {
      out.push(dim("  " + line))
      continue
    }

    const headerMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headerMatch) {
      out.push(bold(headerMatch[2]))
      continue
    }

    out.push(formatInline(line))
  }

  return out.join("\n")
}

function formatInline(line: string): string {
  // Unordered list bullets: * or - at start of line
  line = line.replace(/^(\s*)[\*\-]\s/, "$1• ")

  // Links: [text](url) → text (url)
  line = line.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text, url) => `${text} (${dim(url)})`,
  )

  // Inline code: `code` → cyan
  line = line.replace(/`([^`]+)`/g, (_m, code) => cyan(code))

  // Bold: **text** → bold
  line = line.replace(/\*\*([^*]+)\*\*/g, (_m, text) => bold(text))

  // Italic: *text* (but not ** already handled above)
  line = line.replace(
    /(?<!\*)\*([^*]+)\*(?!\*)/g,
    (_m, text) => italic(text),
  )

  return line
}

// ── ANSI-aware word wrapping ────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g

function visualWidth(s: string): number {
  return s.replace(ANSI_RE, "").length
}

/** Split on spaces, keeping ANSI escape codes attached to adjacent text. */
function splitWords(text: string): string[] {
  const words: string[] = []
  let current = ""
  let inAnsi = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\x1b") {
      inAnsi = true
      current += ch
    } else if (inAnsi) {
      current += ch
      if (ch === "m") inAnsi = false
    } else if (ch === " ") {
      if (current) {
        words.push(current)
        current = ""
      }
    } else {
      current += ch
    }
  }
  if (current) words.push(current)
  return words
}

function wrapOneLine(line: string, indent: string, maxWidth: number): string {
  const words = splitWords(line)
  const lines: string[] = []
  let cur = ""
  let curWidth = 0

  for (const word of words) {
    const w = visualWidth(word)
    const gap = cur ? 1 : 0
    if (curWidth + gap + w > maxWidth && cur) {
      lines.push(cur)
      cur = word
      curWidth = w
    } else {
      cur = cur ? cur + " " + word : word
      curWidth += gap + w
    }
  }
  if (cur) lines.push(cur)
  return lines.join("\n" + indent)
}

/** Indent every line and word-wrap lines that exceed width. */
function wrapAnsi(text: string, indent: string, width: number): string {
  const maxContent = width - indent.length
  if (maxContent < 20) return text

  return text.split("\n").map((line) => {
    if (visualWidth(line) <= maxContent) {
      return indent + line
    }
    return indent + wrapOneLine(line, indent, maxContent)
  }).join("\n")
}
