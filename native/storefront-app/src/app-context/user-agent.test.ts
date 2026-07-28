import { describe, expect, it } from "vitest"
import { buildUserAgentSuffix } from "./user-agent"

describe("buildUserAgentSuffix", () => {
  it("앱 이름·버전·플랫폼을 담은 접미사를 만든다", () => {
    expect(buildUserAgentSuffix({ appVersion: "1.0.0", platform: "android" }))
      .toBe("AlmondyoungApp/1.0.0 (android)")
  })

  it("iOS 플랫폼도 같은 형식을 쓴다", () => {
    expect(buildUserAgentSuffix({ appVersion: "2.3.1", platform: "ios" }))
      .toBe("AlmondyoungApp/2.3.1 (ios)")
  })
})
