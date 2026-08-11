import { describe, expect, it } from "vitest"

import {
  isTransientCartConflictError,
  withCartConflictRetry,
} from "./cart-conflict"

describe("isTransientCartConflictError", () => {
  it("락을 못 잡은 경우", () => {
    expect(
      isTransientCartConflictError(
        new Error('Failed to acquire lock for key "cart_01JABCDEF"')
      )
    ).toBe(true)
  })

  it("방금 지워진 배송수단을 붙들고 있는 경우", () => {
    expect(
      isTransientCartConflictError(
        new Error('ShippingMethod with id "casm_01JABCDEF" not found')
      )
    ).toBe(true)
  })

  it("문자열로 와도 판정한다", () => {
    expect(
      isTransientCartConflictError('Failed to acquire lock for key "cart_1"')
    ).toBe(true)
  })

  it("판매중단 상품은 재시도로 안 풀리므로 제외", () => {
    expect(
      isTransientCartConflictError(
        new Error(
          "Variants variant_01J do not exist or belong to a product that is not published"
        )
      )
    ).toBe(false)
  })

  it("재고 부족도 제외", () => {
    expect(
      isTransientCartConflictError(
        new Error("Some variant does not have the required inventory")
      )
    ).toBe(false)
  })

  it("에러가 아니거나 메시지가 없으면 false", () => {
    expect(isTransientCartConflictError(null)).toBe(false)
    expect(isTransientCartConflictError(undefined)).toBe(false)
    expect(isTransientCartConflictError({})).toBe(false)
  })
})

describe("withCartConflictRetry", () => {
  it("경합이면 한 번 더 시도하고 그 결과를 돌려준다", async () => {
    let calls = 0
    const run = async () => {
      calls += 1
      if (calls === 1) {
        throw new Error('ShippingMethod with id "casm_1" not found')
      }
      return "ok"
    }

    await expect(withCartConflictRetry(run, 0)).resolves.toBe("ok")
    expect(calls).toBe(2)
  })

  it("경합이 아니면 재시도하지 않고 그대로 던진다", async () => {
    let calls = 0
    const run = async () => {
      calls += 1
      throw new Error(
        "Variants variant_1 do not exist or belong to a product that is not published"
      )
    }

    await expect(withCartConflictRetry(run, 0)).rejects.toThrow(
      "do not exist or belong to a product that is not published"
    )
    expect(calls).toBe(1)
  })

  it("두 번째도 실패하면 던진다 — 무한 재시도로 서버를 더 밀지 않는다", async () => {
    let calls = 0
    const run = async () => {
      calls += 1
      throw new Error('Failed to acquire lock for key "cart_1"')
    }

    await expect(withCartConflictRetry(run, 0)).rejects.toThrow(
      "Failed to acquire lock"
    )
    expect(calls).toBe(2)
  })

  it("성공하면 한 번만 부른다", async () => {
    let calls = 0
    const run = async () => {
      calls += 1
      return "ok"
    }

    await expect(withCartConflictRetry(run, 0)).resolves.toBe("ok")
    expect(calls).toBe(1)
  })
})
