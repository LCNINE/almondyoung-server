import { describe, expect, it } from "vitest"

import {
  isTransientCartConflictError,
  withCartConflictRetry,
} from "./cart-conflict"

/** js-sdk 가 던지는 FetchError 와 같은 모양. 상태 코드가 판정의 1차 근거다. */
class FetchErrorLike extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

describe("isTransientCartConflictError", () => {
  it("락을 못 잡은 경우", () => {
    expect(
      isTransientCartConflictError(
        new Error('Failed to acquire lock for key "cart_01JABCDEF"')
      )
    ).toBe(true)
  })

  it("경합을 conflict 로 알려주면 재시도한다", () => {
    expect(
      isTransientCartConflictError(
        new FetchErrorLike(
          "The request conflicted with another request. You may retry the request with the provided Idempotency-Key.",
          409
        )
      )
    ).toBe(true)
  })

  // Medusa 실제 응답 문구. id 뒤에 콜론이 붙고 was 가 들어간다.
  it("방금 지워진 배송수단을 붙들고 있는 경우", () => {
    expect(
      isTransientCartConflictError(
        new FetchErrorLike(
          "ShippingMethod with id: casm_01JABCDEF was not found",
          404
        )
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

  // 락 실패는 MedusaError 가 아니라 평범한 Error 라, Medusa 가 메시지를 통째로 갈아버린다.
  // 원문이 안 오므로 문구로는 잡을 수 없다 — Medusa 가 conflict 로 내려줘야 재시도가 걸린다.
  it("메시지가 지워진 500 은 경합으로 단정하지 않는다", () => {
    expect(
      isTransientCartConflictError(
        new FetchErrorLike("An unknown error occurred.", 500)
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
        throw new FetchErrorLike(
          "ShippingMethod with id: casm_1 was not found",
          404
        )
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
