import { assertEquals } from "@std/assert"
import { join } from "@std/path"

const COMMANDS_ROOT = new URL("../", import.meta.url)

async function listFiles(dirUrl: URL): Promise<string[]> {
  const files: string[] = []
  for await (const entry of Deno.readDir(dirUrl)) {
    if (entry.isDirectory) {
      if (entry.name === "__tests__" || entry.name === "_shared") continue
      files.push(...await listFiles(new URL(`${entry.name}/`, dirUrl)))
      continue
    }
    if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push(join(dirUrl.pathname, entry.name))
    }
  }
  return files
}

Deno.test("command handlers use shared context, not manual api key/client wiring", async () => {
  const files = await listFiles(COMMANDS_ROOT)
  const offenders: string[] = []

  for (const file of files) {
    const source = await Deno.readTextFile(file)
    const isAuth = file.endsWith("/auth.ts")

    if (source.includes("await getAPIKey()")) {
      offenders.push(`${file} -> getAPIKey`)
    }
    if (!isAuth && source.includes("createClient(")) {
      offenders.push(`${file} -> createClient`)
    }
    if (!isAuth && source.includes("getFormat(")) {
      offenders.push(`${file} -> getFormat`)
    }
  }

  assertEquals(
    offenders,
    [],
    `Manual command context wiring found:\n${offenders.join("\n")}`,
  )
})
