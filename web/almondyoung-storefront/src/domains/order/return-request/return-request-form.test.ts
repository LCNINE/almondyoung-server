import { describe, expect, it } from "vitest"
import type { ReturnRequestInput } from "@/lib/types/ui/returns"
import {
  buildReturnFormLines,
  feeNotice,
  initialSelection,
  nextSubmitState,
  setLineQuantity,
  toggleLine,
  validateReturnForm,
  type SubmitState,
} from "./return-request-form"

const NOW = new Date("2026-10-28T00:00:00Z")
const items = [
  { id: "a", title: "A", variantTitle: null, thumbnail: null, quantity: 3 },
  { id: "b", title: "B", variantTitle: "옵션", thumbnail: "t.png", quantity: 2 },
  { id: "c", title: "C", variantTitle: null, thumbnail: null, quantity: 1 },
]
const returnable = [
  { itemId: "a", returnableQuantity: 3, windowEndsAt: "2026-11-05T00:00:00Z" },
  { itemId: "b", returnableQuantity: 2, windowEndsAt: "2026-10-01T00:00:00Z" },
]
const lines = () => buildReturnFormLines(items, returnable, NOW)

describe("return-request-form", () => {
  it("returnable 에 없는 품목은 nothing_left, 기한 지난 줄은 수량이 있어도 window_closed", () => {
    const [a, b, c] = lines()
    expect(a).toMatchObject({ returnable: 3, blocked: "none", orderedQuantity: 3 })
    expect(b).toMatchObject({ returnable: 2, blocked: "window_closed", variantTitle: "옵션" })
    expect(c).toMatchObject({ returnable: 0, blocked: "nothing_left", windowEndsAt: null })
  })

  it("itemId 가 고를 수 있는 줄이면 수량 1 로 미리 고르고, 막힌 줄이면 고르지 않는다", () => {
    expect(initialSelection(lines(), "a")).toEqual({ a: 1 })
    expect(initialSelection(lines(), "b")).toEqual({})
    expect(initialSelection(lines(), "zzz")).toEqual({})
    expect(initialSelection(lines(), undefined)).toEqual({})
  })

  it("수량은 1~returnable 로 자르고 막힌 줄은 토글·수량이 바뀌지 않는다", () => {
    const [a, b] = lines()
    let sel = toggleLine({}, a)
    expect(sel).toEqual({ a: 1 })
    expect(setLineQuantity(sel, a, 99)).toEqual({ a: 3 })
    expect(setLineQuantity(sel, a, 0)).toEqual({ a: 1 })
    expect(toggleLine(sel, a)).toEqual({})
    expect(toggleLine({}, b)).toEqual({})
    expect(setLineQuantity({}, b, 1)).toEqual({})
  })

  it("검증: 고른 줄 없음 → select_item, 사유 없음 → select_reason", () => {
    expect(validateReturnForm({}, "defective")).toBe("select_item")
    expect(validateReturnForm({ a: 1 }, "")).toBe("select_reason")
    expect(validateReturnForm({ a: 1 }, "defective")).toBeNull()
  })

  it("feeNotice: change_of_mind → customer, defective → seller, 빈 값 → null", () => {
    expect(feeNotice("change_of_mind")).toBe("customer")
    expect(feeNotice("defective")).toBe("seller")
    expect(feeNotice("")).toBeNull()
    expect(feeNotice("other")).toBeNull()
  })

  const sent: ReturnRequestInput = { requestId: "id1", items: [{ itemId: "a", quantity: 1 }], reason: "defective" }
  const fresh: SubmitState = { requestId: "id1", locked: null, conflict: false }
  const newId = () => "id2"

  it("unknown → 보낸 본문을 잠그고 id 그대로, 다시 unknown 이어도 같은 id·같은 본문", () => {
    const s1 = nextSubmitState(fresh, sent, { kind: "unknown" }, newId)
    expect(s1).toEqual({ requestId: "id1", locked: sent, conflict: false })
    const s2 = nextSubmitState(s1, s1.locked as ReturnRequestInput, { kind: "unknown" }, newId)
    expect(s2).toEqual(s1)
  })

  it("rejected·unavailable·not_found·canceled_replay → 새 id, 잠금 풀림", () => {
    const locked: SubmitState = { requestId: "id1", locked: sent, conflict: false }
    for (const outcome of [
      { kind: "rejected", reason: "window_closed" },
      { kind: "unavailable" },
      { kind: "not_found" },
      { kind: "canceled_replay" },
    ] as const) {
      expect(nextSubmitState(locked, sent, outcome, newId)).toEqual({ requestId: "id2", locked: null, conflict: false })
    }
  })

  it("rejected request_id_conflict → conflict true, id 그대로", () => {
    const locked: SubmitState = { requestId: "id1", locked: sent, conflict: false }
    expect(nextSubmitState(locked, sent, { kind: "rejected", reason: "request_id_conflict" }, newId)).toEqual({
      requestId: "id1",
      locked: sent,
      conflict: true,
    })
    expect(nextSubmitState(fresh, sent, { kind: "rejected", reason: "request_id_conflict" }, newId).conflict).toBe(true)
  })

  it("requested → 상태 그대로(화면이 완료로 넘어간다)", () => {
    expect(nextSubmitState(fresh, sent, { kind: "requested", returnId: "r" }, newId)).toEqual(fresh)
  })
})
