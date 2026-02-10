import { ensureDir } from "@std/fs"
import { dirname, join } from "@std/path"
import { parse, stringify } from "@std/toml"
import { CliError } from "./errors.ts"

export interface CredentialsData {
  default?: string
  [workspace: string]: string | undefined
}

export function credentialsPath(): string {
  const xdgConfig = Deno.env.get("XDG_CONFIG_HOME")
  const home = Deno.env.get("HOME")
  if (!xdgConfig && !home) {
    throw new CliError("unable to resolve home directory", 1)
  }
  const base = xdgConfig ?? join(home as string, ".config")
  return join(base, "linear", "credentials.toml")
}

export async function loadCredentials(): Promise<CredentialsData> {
  const path = credentialsPath()
  try {
    const text = await Deno.readTextFile(path)
    const data = parse(text) as CredentialsData
    return data ?? {}
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {}
    }
    throw error
  }
}

export async function saveCredentials(
  workspace: string,
  apiKey: string,
): Promise<void> {
  const path = credentialsPath()
  const data = await loadCredentials()
  const next: CredentialsData = {
    ...data,
    [workspace]: apiKey,
    default: data.default ?? workspace,
  }
  await ensureDir(dirname(path))
  await Deno.writeTextFile(path, stringify(next))
}

export async function removeCredentials(workspace: string): Promise<void> {
  const path = credentialsPath()
  const data = await loadCredentials()
  if (!data[workspace]) {
    return
  }
  const { default: defaultWorkspace } = data
  delete data[workspace]
  if (defaultWorkspace === workspace) {
    const remaining = Object.keys(data).filter((key) => key !== "default")
    data.default = remaining[0]
  }
  await ensureDir(dirname(path))
  await Deno.writeTextFile(path, stringify(data))
}

export async function getAPIKey(workspace?: string): Promise<string> {
  const envKey = Deno.env.get("LINEAR_API_KEY")
  if (envKey) {
    return envKey
  }
  const data = await loadCredentials()
  const target = workspace ?? data.default
  if (target && data[target]) {
    return data[target] as string
  }
  throw new CliError("not authenticated", 2, "run 'linear-cli auth login'")
}
