import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error"
import { describe, expect, it } from "vitest"
import { failureMessage } from "./use-auth-retry"

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
