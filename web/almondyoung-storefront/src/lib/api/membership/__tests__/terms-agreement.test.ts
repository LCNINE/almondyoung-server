import { beforeEach, describe, expect, it, vi } from "vitest"

const apiMock = vi.fn()
vi.mock("../../api", () => ({ api: (...args: unknown[]) => apiMock(...args) }))

import { HttpApiError } from "../../api-error"
import { recordMembershipTermsAgreement } from ".."

const input = { termsVersion: "v", planId: "p", billingMode: "recurring" as const }

const call = async () => {
  try {
    return { value: await recordMembershipTermsAgreement(input) }
  } catch (error) {
    return { error }
  }
}

describe("recordMembershipTermsAgreement", () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it("동의 id 를 돌려준다", async () => {
    apiMock.mockResolvedValue({ agreementId: "a1" })
    expect(await call()).toEqual({ value: { agreementId: "a1" } })
  })

  it("동의 기록을 모르는 옛 서버(404)면 id 없이 진행한다 — 화면이 먼저 배포돼도 가입이 막히지 않게", async () => {
    apiMock.mockImplementation(async () => {
      throw new HttpApiError("Not Found", 404, "Not Found")
    })
    expect(await call()).toEqual({ value: {} })
  })

  it("그 밖의 실패는 그대로 던진다 — 동의가 안 남은 채 가입을 진행하지 않는다", async () => {
    apiMock.mockImplementation(async () => {
      throw new HttpApiError("boom", 500, "Internal")
    })
    const result = await call()
    expect(result.error).toBeInstanceOf(HttpApiError)
  })
})
