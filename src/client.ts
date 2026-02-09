import { LinearClient } from "@linear/sdk"

export function createClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey })
}
