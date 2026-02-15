import { assertEquals } from "@std/assert"
import { join } from "@std/path"

const COMMANDS_ROOT = new URL("../", import.meta.url)

async function listCommandFiles(dirUrl: URL): Promise<string[]> {
  const files: string[] = []
  for await (const entry of Deno.readDir(dirUrl)) {
    const nextPath = join(dirUrl.pathname, entry.name)
    if (entry.isDirectory) {
      if (entry.name === "__tests__" || entry.name === "_shared") continue
      files.push(...await listCommandFiles(new URL(`${entry.name}/`, dirUrl)))
      continue
    }
    if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push(nextPath)
    }
  }
  return files
}

Deno.test("command handlers do not directly call console.log/error", async () => {
  const files = await listCommandFiles(COMMANDS_ROOT)
  const offenders: string[] = []

  for (const file of files) {
    const text = await Deno.readTextFile(file)
    if (/console\.(log|error)\(/.test(text)) {
      offenders.push(file)
    }
  }

  assertEquals(
    offenders,
    [],
    `Direct console usage is not allowed in command handlers:\n${
      offenders.join("\n")
    }`,
  )
})
