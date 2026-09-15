import { describe, expect, it } from "vitest"
import { pickEarliestRestock } from "./restock"

// variant 최소 형태. pickEarliestRestock 은 metadata 만 본다.
const v = (inboundDate?: string | null, inboundApproximate?: boolean) =>
  ({ metadata: { inboundDate, inboundApproximate } }) as never

const iso = (offsetDays: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

describe("pickEarliestRestock", () => {
  it("입고예정일이 없으면 null", () => {
    expect(pickEarliestRestock([v(), v(null)])).toBeNull()
  })

  // 지난 날짜를 그대로 쓰면 "재입고 : 7월 14일 예정" 처럼 이미 지난 날을 안내하게 된다.
  it("지난 날짜는 후보에서 뺀다", () => {
    expect(pickEarliestRestock([v(iso(-1))])).toBeNull()
  })

  it("미래 날짜 중 가장 이른 것을 고른다", () => {
    const soon = iso(3)
    expect(pickEarliestRestock([v(iso(30)), v(soon), v(iso(10))])?.date).toBe(soon)
  })

  it("지난 날짜와 섞여 있으면 미래 것만 본다", () => {
    const soon = iso(5)
    expect(pickEarliestRestock([v(iso(-10)), v(soon)])?.date).toBe(soon)
  })

  it("해외 발주는 approximate 를 전달한다", () => {
    expect(pickEarliestRestock([v(iso(7), true)])?.approximate).toBe(true)
    expect(pickEarliestRestock([v(iso(7))])?.approximate).toBe(false)
  })
})
