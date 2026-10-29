import { describe, expect, it } from "vitest"
import type { ReturnRequestInput } from "@/lib/types/ui/returns"
import {
  buildReturnFormLines,
  copyKey,
  feeNotice,
  initialSelection,
  nextSubmitState,
  reasonsFor,
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
  { itemId: "a", returnableQuantity: 3, windowEndsAt: "2026-11-05T00:00:00Z", exchangeable: true },
  { itemId: "b", returnableQuantity: 2, windowEndsAt: "2026-10-01T00:00:00Z", exchangeable: true },
]
const lines = () => buildReturnFormLines(items, returnable, NOW, "return")

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
    expect(feeNotice("change_of_mind", "return")).toBe("customer")
    expect(feeNotice("defective", "return")).toBe("seller")
    expect(feeNotice("", "return")).toBeNull()
    expect(feeNotice("other", "return")).toBeNull()
  })

  describe("교환 모드", () => {
    // p: 인쇄 줄(교환 불가, 반품은 된다), q: 인쇄 줄인데 남은 수량 0, r: 인쇄 줄인데 기한도 지남
    const exItems = [
      ...items,
      { id: "p", title: "P", variantTitle: null, thumbnail: null, quantity: 1 },
      { id: "q", title: "Q", variantTitle: null, thumbnail: null, quantity: 1 },
      { id: "r", title: "R", variantTitle: null, thumbnail: null, quantity: 1 },
    ]
    const exReturnable = [
      ...returnable,
      { itemId: "p", returnableQuantity: 1, windowEndsAt: "2026-11-05T00:00:00Z", exchangeable: false },
      { itemId: "q", returnableQuantity: 0, windowEndsAt: "2026-11-05T00:00:00Z", exchangeable: false },
      { itemId: "r", returnableQuantity: 1, windowEndsAt: "2026-10-01T00:00:00Z", exchangeable: false },
    ]
    const byId = (mode: "return" | "exchange") =>
      Object.fromEntries(buildReturnFormLines(exItems, exReturnable, NOW, mode).map((l) => [l.itemId, l]))

    it("exchangeable false 줄 → not_exchangeable, 남은 수량 0 이면 nothing_left 가 먼저, 기한보다 not_exchangeable 이 먼저", () => {
      const lines = byId("exchange")
      expect(lines.p).toMatchObject({ blocked: "not_exchangeable", exchangeable: false, returnable: 1 })
      expect(lines.q).toMatchObject({ blocked: "nothing_left" })
      expect(lines.r).toMatchObject({ blocked: "not_exchangeable" })
      expect(lines.a).toMatchObject({ blocked: "none", exchangeable: true })
      expect(lines.b).toMatchObject({ blocked: "window_closed" })
      expect(lines.c).toMatchObject({ blocked: "nothing_left", exchangeable: false })
    })

    it("반품 모드에서는 exchangeable false 여도 막지 않는다", () => {
      const lines = byId("return")
      expect(lines.p).toMatchObject({ blocked: "none", exchangeable: false })
      expect(lines.r).toMatchObject({ blocked: "window_closed" })
    })

    it("막힌 줄 itemId 는 미리 고르지 않고 토글도 안 된다", () => {
      const lines = buildReturnFormLines(exItems, exReturnable, NOW, "exchange")
      expect(initialSelection(lines, "p")).toEqual({})
      const p = lines.find((l) => l.itemId === "p")!
      expect(toggleLine({}, p)).toEqual({})
    })

    it("reasonsFor: 교환은 판매자 부담 넷, 반품은 고객 사유 다섯", () => {
      expect(reasonsFor("exchange").map((r) => r.value)).toEqual([
        "defective",
        "not_as_described",
        "wrong_item",
        "damaged_in_shipping",
      ])
      expect(reasonsFor("return").map((r) => r.value)).toEqual([
        "change_of_mind",
        "defective",
        "not_as_described",
        "wrong_item",
        "damaged_in_shipping",
      ])
    })

    it("feeNotice: 교환은 어느 사유든(빈 값 포함) seller", () => {
      for (const reason of ["change_of_mind", "defective", "other", ""]) {
        expect(feeNotice(reason, "exchange")).toBe("seller")
      }
    })

    it("copyKey: 교환은 exchange.<key>, 반품은 그대로", () => {
      expect(copyKey("exchange", "title")).toBe("exchange.title")
      expect(copyKey("exchange", "done")).toBe("exchange.done")
      expect(copyKey("return", "title")).toBe("title")
      expect(copyKey("return", "empty")).toBe("empty")
    })
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

  it("교환 unknown 뒤 잠긴 본문에 kind 'exchange' 가 남는다", () => {
    const exSent: ReturnRequestInput = { ...sent, kind: "exchange" }
    const s1 = nextSubmitState(fresh, exSent, { kind: "unknown" }, newId)
    expect(s1.locked?.kind).toBe("exchange")
    expect(s1.requestId).toBe("id1")
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
