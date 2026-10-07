import { describe, expect, it } from "vitest"
import { cancelOutcomeOf, waitForCancelOutcome } from "./cancel-outcome"

describe("cancelOutcomeOf", () => {
  it.each([
    [{ orderStatus: "cancelled" }, "cancelled"],
    [{ orderStatus: "confirmed", cancelRequestStatus: "rejected" as const }, "rejected"],
    [{ orderStatus: "confirmed", cancelRequestStatus: "requested" as const }, "pending"],
    [{ orderStatus: "confirmed" }, "pending"],
  ])("%o → %s", (actions, outcome) => expect(cancelOutcomeOf(actions)).toBe(outcome))
})

describe("waitForCancelOutcome — 2초마다 최대 30초", () => {
  const instant = () => Promise.resolve()

  it("끝나면 그 결과를 돌려준다", async () => {
    const reads = [{ orderStatus: "confirmed", cancelRequestStatus: "requested" as const }, { orderStatus: "cancelled" }]
    const read = () => Promise.resolve(reads.shift() ?? null)
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("cancelled")
  })

  it("30초를 넘기면 pending 으로 멈춘다 — 15번 읽는다", async () => {
    let count = 0
    const read = () => {
      count += 1
      return Promise.resolve({ orderStatus: "confirmed", cancelRequestStatus: "requested" as const })
    }
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("pending")
    expect(count).toBe(15)
  })

  it("읽기 실패(null)는 기다림을 끝내지 않는다", async () => {
    const reads = [null, { orderStatus: "confirmed", cancelRequestStatus: "rejected" as const }]
    const read = () => Promise.resolve(reads.shift() ?? null)
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("rejected")
  })
})
