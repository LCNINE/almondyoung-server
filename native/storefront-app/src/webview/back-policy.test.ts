import { describe, expect, it } from "vitest"
import { decideBack } from "./back-policy"

describe("decideBack", () => {
  it("웹뷰 히스토리가 있으면 go-back 이다", () => {
    expect(
      decideBack({ canGoBack: true, now: 1_000_000, lastBackPress: 0 }),
    ).toBe("go-back")
  })

  it("루트에서 첫 번째 back 은 warn 이다", () => {
    expect(
      decideBack({ canGoBack: false, now: 1_000_000, lastBackPress: 0 }),
    ).toBe("warn")
  })

  it("루트에서 윈도우 안에 두 번째 back 이 오면 exit 이다", () => {
    const lastBackPress = 1_000_000
    const now = lastBackPress + 500 // 2000ms 윈도우 안
    expect(decideBack({ canGoBack: false, now, lastBackPress })).toBe("exit")
  })

  it("루트에서 윈도우가 지난 뒤 두 번째 back 은 다시 warn 이다", () => {
    const lastBackPress = 1_000_000
    const now = lastBackPress + 2001 // 2000ms 윈도우 밖
    expect(decideBack({ canGoBack: false, now, lastBackPress })).toBe("warn")
  })

  it("윈도우 경계(diff === exitWindowMs)는 exit 이 아니라 warn 이다 — exit 판정은 diff < exitWindowMs 로 배타적이다", () => {
    const lastBackPress = 1_000_000
    const now = lastBackPress + 2000 // 정확히 경계
    expect(decideBack({ canGoBack: false, now, lastBackPress })).toBe("warn")
  })

  it("exitWindowMs 커스텀 값도 같은 배타적 경계 규칙을 따른다", () => {
    const lastBackPress = 1_000_000
    expect(
      decideBack({
        canGoBack: false,
        now: lastBackPress + 499,
        lastBackPress,
        exitWindowMs: 500,
      }),
    ).toBe("exit")
    expect(
      decideBack({
        canGoBack: false,
        now: lastBackPress + 500,
        lastBackPress,
        exitWindowMs: 500,
      }),
    ).toBe("warn")
  })

  it("go-back 이후에는 원래 윈도우 안이라도 lastBackPress 가 리셋되어 다시 warn 이다", () => {
    // MainWebView 는 decideBack 이 "go-back" 을 반환하면 lastBackPress 를 0 으로
    // 리셋한다. 이 테스트는 그 호출 계약을 시뮬레이션한다:
    // warn(경고 토스트) → go-back(상세 페이지 진입 후 복귀) → 원래 2초 윈도우
    // 안에 다시 back 을 눌러도 곧바로 종료되지 않고 다시 경고해야 한다.
    let lastBackPress = 0

    const t1 = 1_000_000
    expect(decideBack({ canGoBack: false, now: t1, lastBackPress })).toBe(
      "warn",
    )
    lastBackPress = t1 // 컴포넌트가 warn 시 기록하는 타임스탬프

    const t2 = t1 + 500
    expect(decideBack({ canGoBack: true, now: t2, lastBackPress })).toBe(
      "go-back",
    )
    lastBackPress = 0 // 컴포넌트가 go-back 시 리셋

    const t3 = t1 + 1500 // 원래 t1 기준 2000ms 윈도우 안이지만 리셋되었다
    expect(decideBack({ canGoBack: false, now: t3, lastBackPress })).toBe(
      "warn",
    )
  })
})
