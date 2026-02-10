export class CliError extends Error {
  code: number
  hint?: string

  constructor(message: string, code = 1, hint?: string) {
    super(message)
    this.code = code
    this.hint = hint
  }
}
