import { describe, expect, it } from "vitest"

import {
  cancelOutcomeFromError,
  requestOutcomeFromError,
  requestOutcomeFromResponse,
  toReturnRequestBody,
} from "./return-outcome"

const res = (status: string) => ({
  return_id: "ret_1",
  request_id: "r",
  status,
  items: [],
  fee_bearer: "customer",
  window_overridden: false,
})

describe("return-outcome", () => {
  it("200 requested → requested, 200 canceled → canceled_replay", () => {
    expect(requestOutcomeFromResponse(res("requested"))).toEqual({
      kind: "requested",
      returnId: "ret_1",
    })
    expect(requestOutcomeFromResponse(res("canceled"))).toEqual({
      kind: "canceled_replay",
    })
  })

  it("400 return_rejected → rejected(reason), 502 core_unavailable → unavailable, 404 → not_found", () => {
    expect(
      requestOutcomeFromError(400, {
        type: "not_allowed",
        code: "return_rejected",
        reason: "window_closed",
      })
    ).toEqual({ kind: "rejected", reason: "window_closed" })
    expect(
      requestOutcomeFromError(502, { type: "core_unavailable" })
    ).toEqual({ kind: "unavailable" })
    expect(requestOutcomeFromError(404, { type: "not_found" })).toEqual({
      kind: "not_found",
    })
  })

  it("네트워크(null)·500·코드 없는 400 → unknown", () => {
    expect(requestOutcomeFromError(null, undefined)).toEqual({
      kind: "unknown",
    })
    expect(requestOutcomeFromError(500, undefined)).toEqual({ kind: "unknown" })
    expect(requestOutcomeFromError(400, { type: "invalid_data" })).toEqual({
      kind: "unknown",
    })
  })

  it("본문은 snake_case, 빈 메모는 싣지 않고 앞뒤 공백을 지운다", () => {
    const input = {
      requestId: "r1",
      items: [{ itemId: "i1", quantity: 2 }],
      reason: "defective",
    }
    expect(toReturnRequestBody({ ...input, note: "   " })).toEqual({
      request_id: "r1",
      items: [{ item_id: "i1", quantity: 2 }],
      reason: "defective",
    })
    expect(toReturnRequestBody({ ...input, note: "  깨짐 " }).note).toBe("깨짐")
  })

  it("취소: 400 return_arrived → rejected, 404 → not_found, 500 → unknown", () => {
    expect(
      cancelOutcomeFromError(400, { reason: "return_arrived" })
    ).toEqual({ kind: "rejected", reason: "return_arrived" })
    expect(cancelOutcomeFromError(404, undefined)).toEqual({
      kind: "not_found",
    })
    expect(cancelOutcomeFromError(500, undefined)).toEqual({ kind: "unknown" })
  })
})
