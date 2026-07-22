import { shouldRejectCallbackStatus } from "./callback-status"

describe("shouldRejectCallbackStatus", () => {
  it.each([null, "failed", "cancelled"])(
    "allows membership confirmation when URL status is %p",
    (status) => {
      expect(shouldRejectCallbackStatus(status, "membership")).toBe(false)
    }
  )

  it.each([null, "failed", "cancelled"])(
    "keeps rejecting a non-membership callback when URL status is %p",
    (status) => {
      expect(shouldRejectCallbackStatus(status, "one_time")).toBe(true)
    }
  )

  it("accepts a succeeded callback for every payment mode", () => {
    expect(shouldRejectCallbackStatus("succeeded", "membership")).toBe(false)
    expect(shouldRejectCallbackStatus("succeeded", "one_time")).toBe(false)
    expect(shouldRejectCallbackStatus("succeeded", null)).toBe(false)
  })
})
