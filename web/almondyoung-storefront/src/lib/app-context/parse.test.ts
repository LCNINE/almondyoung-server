import { describe, expect, it } from "vitest"
import {
  APP_CONTEXT_HEADER,
  deserializeAppContext,
  parseAppContext,
  serializeAppContext,
} from "./parse"

describe("parseAppContext", () => {
  it("앱 UA 접미사에서 플랫폼과 버전을 뽑는다", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 AlmondyoungApp/1.0.0 (android)"
    expect(parseAppContext(ua)).toEqual({ platform: "android", version: "1.0.0" })
  })

  it("ios 플랫폼도 인식한다", () => {
    expect(parseAppContext("… AlmondyoungApp/2.3.1 (ios)")).toEqual({
      platform: "ios",
      version: "2.3.1",
    })
  })

  it("일반 브라우저 UA 는 null 을 준다", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
    expect(parseAppContext(ua)).toBeNull()
  })

  it("UA 가 없으면 null 을 준다", () => {
    expect(parseAppContext(null)).toBeNull()
    expect(parseAppContext(undefined)).toBeNull()
  })

  it("모르는 플랫폼 문자열은 null 을 준다", () => {
    expect(parseAppContext("… AlmondyoungApp/1.0.0 (windows)")).toBeNull()
  })
})

describe("app context 직렬화", () => {
  it("직렬화 후 복원하면 같은 값이 된다", () => {
    const ctx = { platform: "android", version: "1.0.0" } as const
    expect(deserializeAppContext(serializeAppContext(ctx))).toEqual(ctx)
  })

  it("빈 값이나 모르는 플랫폼은 null 이 된다", () => {
    expect(deserializeAppContext(null)).toBeNull()
    expect(deserializeAppContext("windows/1.0.0")).toBeNull()
    expect(deserializeAppContext("android/")).toBeNull()
  })
})

// 미들웨어는 클라이언트 요청 헤더를 그대로 복사한 뒤 APP_CONTEXT_HEADER 를 조건부로만
// set 한다. 헤더 스푸핑(클라이언트가 x-almondyoung-app 을 직접 실어 보내는 것) 자체는
// Next 요청 하네스 없이는 단위 테스트로 재현할 수 없으므로, 그 방어의 근거가 되는
// parseAppContext 쪽 불변식만 단위 테스트로 고정한다: UA 가 정확한 앱 접미사 형식이
// 아니면, UA 안에 헤더 이름/값을 흉내낸 문자열이 섞여 있어도 절대 통과하지 못한다.
describe("헤더 위조 방어 (parseAppContext 불변식)", () => {
  it("UA 안에 위조된 헤더 형식 문자열이 섞여 있어도 정확한 앱 접미사가 아니면 null 을 준다", () => {
    const forgedUa = `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 ${APP_CONTEXT_HEADER}: android/9.9.9`
    expect(parseAppContext(forgedUa)).toBeNull()
  })

  it("UA 에 진짜 헤더 이름과 직렬화 값을 그대로 흉내내도 AlmondyoungApp 접미사가 없으면 null 을 준다", () => {
    const forgedUa = `${APP_CONTEXT_HEADER}=${serializeAppContext({ platform: "android", version: "9.9.9" })}`
    expect(parseAppContext(forgedUa)).toBeNull()
  })
})
