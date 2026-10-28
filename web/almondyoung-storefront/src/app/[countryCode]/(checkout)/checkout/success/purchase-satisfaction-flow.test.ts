import { describe, expect, it, vi } from "vitest"
import { createSatisfactionFlow } from "./purchase-satisfaction-flow"

const saved = (rating: number) => ({ rating, reasons: [], memo: null })

function setup(initial: Parameters<typeof createSatisfactionFlow>[0]["initial"] = null) {
  const save = vi.fn(async (_id: string, i: { rating: number }) => saved(i.rating))
  const track = vi.fn()
  const flow = createSatisfactionFlow({ orderId: "order_1", initial, save, track })
  return { flow, save, track }
}

describe("구매 만족도 흐름", () => {
  it("initial 이 있으면 감사 단계부터 시작한다", () => {
    const { flow } = setup({ rating: 5, reasons: [], memo: null })
    expect(flow.getState()).toMatchObject({ step: "thanks", rating: 5 })
  })

  it("3점 클릭 → 즉시 저장하고 세부 단계로 간다", async () => {
    const { flow, save, track } = setup()
    await flow.selectRating(3)
    expect(save).toHaveBeenCalledWith("order_1", { rating: 3 })
    expect(track).toHaveBeenCalledWith("purchase_satisfaction", { rating: 3 })
    expect(flow.getState().step).toBe("detail")
  })

  it("5점 클릭 → 감사 단계", async () => {
    const { flow } = setup()
    await flow.selectRating(5)
    expect(flow.getState().step).toBe("thanks")
  })

  it("저장 중에는 saving 이고 다른 클릭은 무시한다", async () => {
    let release!: () => void
    const save = vi.fn(
      (_id: string, i: { rating: number }) =>
        new Promise<ReturnType<typeof saved>>((r) => {
          release = () => r(saved(i.rating))
        })
    )
    const flow = createSatisfactionFlow({ orderId: "o", initial: null, save, track: vi.fn() })
    const p = flow.selectRating(2)
    expect(flow.getState().saving).toBe(true)
    await flow.selectRating(4)
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await p
    expect(flow.getState().saving).toBe(false)
  })

  it("저장 실패 → 실패 표시와 함께 선택된 별을 되돌리고 이벤트는 보내지 않는다", async () => {
    const { flow, save, track } = setup()
    save.mockRejectedValueOnce(new Error("x"))
    await flow.selectRating(3)
    expect(flow.getState()).toMatchObject({ step: "rate", rating: 0, failed: true })
    expect(track).not.toHaveBeenCalled()
  })

  it("칩·메모가 없으면 보내기 불가, 있으면 가능(공백 메모는 없는 것)", async () => {
    const { flow } = setup()
    await flow.selectRating(2)
    expect(flow.canSubmit()).toBe(false)
    flow.setMemo("   ")
    expect(flow.canSubmit()).toBe(false)
    flow.toggleReason("OTHER")
    expect(flow.canSubmit()).toBe(true)
    flow.toggleReason("OTHER")
    expect(flow.canSubmit()).toBe(false)
  })

  it("메모는 300자로 자른다", async () => {
    const { flow } = setup()
    await flow.selectRating(2)
    flow.setMemo("a".repeat(400))
    expect(flow.getState().memo).toHaveLength(300)
  })

  it("보내기 → 사유·메모(trim)와 함께 저장하고 detail 이벤트 후 감사 단계", async () => {
    const { flow, save, track } = setup()
    await flow.selectRating(2)
    flow.toggleReason("PAYMENT_ERROR")
    flow.toggleReason("OTHER")
    flow.setMemo("  메모  ")
    await flow.submitDetail()
    expect(save).toHaveBeenLastCalledWith("order_1", {
      rating: 2,
      reasons: ["PAYMENT_ERROR", "OTHER"],
      memo: "메모",
    })
    expect(track).toHaveBeenLastCalledWith("purchase_satisfaction_detail", { reasons_count: 2 })
    expect(flow.getState().step).toBe("thanks")
  })

  it("메모가 비면 memo 를 보내지 않는다", async () => {
    const { flow, save } = setup()
    await flow.selectRating(1)
    flow.toggleReason("OTHER")
    await flow.submitDetail()
    expect(save).toHaveBeenLastCalledWith("order_1", { rating: 1, reasons: ["OTHER"] })
  })

  it("보내기 저장 실패면 세부 단계에 머문다", async () => {
    const { flow, save, track } = setup()
    await flow.selectRating(2)
    flow.toggleReason("OTHER")
    save.mockRejectedValueOnce(new Error("x"))
    await flow.submitDetail()
    expect(flow.getState()).toMatchObject({ step: "detail", failed: true, saving: false })
    expect(track).toHaveBeenCalledTimes(1)
  })

  it("다음에 → 요청 없이 감사 단계", async () => {
    const { flow, save } = setup()
    await flow.selectRating(3)
    save.mockClear()
    flow.skip()
    expect(save).not.toHaveBeenCalled()
    expect(flow.getState().step).toBe("thanks")
  })

  it("별점 바꾸기 → 별 선택 단계로 돌아간다", () => {
    const { flow } = setup({ rating: 5, reasons: [], memo: null })
    flow.changeRating()
    expect(flow.getState().step).toBe("rate")
  })
})
