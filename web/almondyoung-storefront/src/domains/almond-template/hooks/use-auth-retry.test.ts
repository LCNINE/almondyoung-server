import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error"
import { describe, expect, it, vi } from "vitest"
import { failureMessage, retryTransient } from "./use-auth-retry"

describe("failureMessage", () => {
  it("배포 전에 연 탭의 서버 액션 실패는 새로고침을 안내한다", () => {
    const error = new UnrecognizedActionError("not found")

    expect(failureMessage(error, "글꼴을 올리지 못했습니다.")).toContain(
      "새로고침"
    )
  })

  it("그 밖의 실패는 호출한 곳의 문구를 그대로 쓴다", () => {
    const failure = "글꼴을 올리지 못했습니다."

    expect(failureMessage(new Error("boom"), failure)).toBe(failure)
  })
})

describe("retryTransient", () => {
  it("일시 실패는 다시 보내 성공한 값을 돌려준다", async () => {
    vi.useFakeTimers()
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ok")

    const result = retryTransient(run)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("정해진 횟수를 넘기면 마지막 오류를 던진다", async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {
      throw new Error("down")
    })

    const result = retryTransient(run, 3)
    const settled = expect(result).rejects.toThrow("down")
    await vi.runAllTimersAsync()

    await settled
    expect(run).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it("로그인 만료와 배포 전 탭은 다시 보내지 않는다", async () => {
    for (const error of [
      new Error("UNAUTHORIZED"),
      new UnrecognizedActionError("not found"),
    ]) {
      const run = vi.fn(async () => {
        throw error
      })

      await expect(retryTransient(run)).rejects.toBe(error)
      expect(run).toHaveBeenCalledTimes(1)
    }
  })
})
