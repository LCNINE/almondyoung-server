import { describe, expect, it, vi } from "vitest"
import { ensureCustomOrderAgreement } from "./custom-order-agreement"

async function pay(
  opts: Parameters<typeof ensureCustomOrderAgreement>[0],
  createPaymentSession: () => void
) {
  if (await ensureCustomOrderAgreement(opts)) createPaymentSession()
}

describe("ensureCustomOrderAgreement", () => {
  it("does not create a payment session while not agreed", async () => {
    const save = vi.fn()
    const create = vi.fn()
    await pay({ needsAgreement: true, agreed: false, saveAgreement: save }, create)
    expect(save).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not create a payment session when saving the agreement fails", async () => {
    const create = vi.fn()
    vi.spyOn(console, "error").mockImplementation(() => {})
    await pay(
      {
        needsAgreement: true,
        agreed: true,
        saveAgreement: () => Promise.reject(new Error("boom")),
      },
      create
    )
    expect(create).not.toHaveBeenCalled()
  })

  it("saves then proceeds when agreed, and skips saving when not needed", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn()
    await pay({ needsAgreement: true, agreed: true, saveAgreement: save }, create)
    expect(save).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)

    const save2 = vi.fn()
    await pay({ needsAgreement: false, agreed: false, saveAgreement: save2 }, create)
    expect(save2).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(2)
  })
})
