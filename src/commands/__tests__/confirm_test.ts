import { assertEquals } from "@std/assert"
import { confirmDangerousAction } from "../_shared/confirm.ts"

Deno.test("confirmDangerousAction bypasses prompt when skipConfirm is true", async () => {
  const confirmed = await confirmDangerousAction({
    prompt: "Delete item?",
    skipConfirm: true,
  })

  assertEquals(confirmed, true)
})
