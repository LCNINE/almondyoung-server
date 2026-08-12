import { describe, expect, it } from "vitest"
import { createRefreshThrottle } from "./refresh-throttle"

const clock = (start = 0) => {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("createRefreshThrottle", () => {
  it("같은 키는 창 안에서 한 번만 통과시킨다", () => {
    const time = clock()
    const throttle = createRefreshThrottle(1000, time.now)

    expect(throttle.take("cart_1:mem")).toBe(true)
    expect(throttle.take("cart_1:mem")).toBe(false)
    expect(throttle.take("cart_1:mem")).toBe(false)
  })

  it("키가 다르면 서로 막지 않는다", () => {
    const time = clock()
    const throttle = createRefreshThrottle(1000, time.now)

    expect(throttle.take("cart_1:reg")).toBe(true)
    // 멤버십 상태가 바뀌면 키가 달라져 곧바로 다시 돈다.
    expect(throttle.take("cart_1:mem")).toBe(true)
    expect(throttle.take("cart_2:reg")).toBe(true)
  })

  it("창이 지나면 다시 통과시킨다", () => {
    const time = clock()
    const throttle = createRefreshThrottle(1000, time.now)

    expect(throttle.take("cart_1:mem")).toBe(true)
    time.advance(999)
    expect(throttle.take("cart_1:mem")).toBe(false)
    time.advance(1)
    expect(throttle.take("cart_1:mem")).toBe(true)
  })

  it("만료된 키는 들고 있지 않는다", () => {
    const time = clock()
    const throttle = createRefreshThrottle(1000, time.now)

    throttle.take("cart_1:mem")
    time.advance(1000)
    // 다른 키를 통과시키는 김에 만료된 항목이 정리되고, 그 뒤에도 판정은 그대로다.
    expect(throttle.take("cart_2:mem")).toBe(true)
    expect(throttle.take("cart_1:mem")).toBe(true)
  })
})
