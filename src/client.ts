import { LinearClient } from "@linear/sdk"

export function createClient(apiKey: string): LinearClient {
  // LinearClientOptions has no timeout property. The SDK's headers
  // field expects a Headers object and doesn't support request timeouts.
  // AbortSignal.timeout would apply to the client lifetime, not per-request.
  return new LinearClient({ apiKey })
}
