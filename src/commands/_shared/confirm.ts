interface ConfirmDangerousActionOptions {
  prompt: string
  skipConfirm: boolean
}

/** Ask for explicit confirmation. Returns false on any answer other than "y". */
export async function confirmDangerousAction(
  options: ConfirmDangerousActionOptions,
): Promise<boolean> {
  if (options.skipConfirm || !Deno.stdin.isTerminal()) {
    return true
  }

  const encoder = new TextEncoder()
  await Deno.stdout.write(encoder.encode(`${options.prompt} [y/N] `))

  const buf = new Uint8Array(128)
  const n = await Deno.stdin.read(buf)
  const answer = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
  return answer.toLowerCase() === "y"
}
