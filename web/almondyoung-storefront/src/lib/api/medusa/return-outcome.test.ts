import { describe, expect, it } from "vitest"

import {
  cancelOutcomeFromError,
  requestOutcomeFromError,
  requestOutcomeFromResponse,
  toCustomerReturns,
  toReturnRequestBody,
  toReturnableLines,
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

  it("교환 본문에는 kind 'exchange', 반품 본문에는 kind 키 자체가 없다(옛 요청 해시 그대로)", () => {
    const input = {
      requestId: "r1",
      items: [{ itemId: "i1", quantity: 1 }],
      reason: "defective",
    }
    expect(toReturnRequestBody({ ...input, kind: "exchange" })).toEqual({
      request_id: "r1",
      items: [{ item_id: "i1", quantity: 1 }],
      reason: "defective",
      kind: "exchange",
    })
    const plain = toReturnRequestBody(input)
    expect(Object.prototype.hasOwnProperty.call(plain, "kind")).toBe(false)
    expect(JSON.stringify(plain)).toBe(
      JSON.stringify({ request_id: "r1", items: [{ item_id: "i1", quantity: 1 }], reason: "defective" })
    )
  })

  it("toCustomerReturns: kind 없는 응답은 return, exchange 는 그대로·단계 exchanged 그대로", () => {
    const row = {
      return_id: "ret_1",
      stage: "requested" as const,
      requested_at: "2026-10-28T00:00:00Z",
      reason: "defective",
      fee_bearer: "seller" as const,
      items: [{ item_id: "i1", quantity: 1 }],
      can_cancel: true,
    }
    const [plain, exchange] = toCustomerReturns({
      returns: [row, { ...row, return_id: "ret_2", kind: "exchange", stage: "exchanged" }],
    })
    expect(plain.kind).toBe("return")
    expect(exchange).toMatchObject({ kind: "exchange", stage: "exchanged" })
  })

  it("toReturnableLines: exchangeable 이 true 일 때만 true(없으면 false)", () => {
    const lines = toReturnableLines({
      items: [
        { item_id: "a", returnable_quantity: 1, window_ends_at: null, exchangeable: true },
        { item_id: "b", returnable_quantity: 1, window_ends_at: null, exchangeable: false },
        { item_id: "c", returnable_quantity: 1, window_ends_at: null },
      ],
    })
    expect(lines.map((l) => l.exchangeable)).toEqual([true, false, false])
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
