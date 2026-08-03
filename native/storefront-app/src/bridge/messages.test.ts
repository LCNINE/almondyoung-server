import { describe, expect, it } from "vitest"
import { parseBridgeMessage } from "./messages"

describe("parseBridgeMessage", () => {
  it("로그아웃 메시지를 인식한다", () => {
    expect(parseBridgeMessage('{"type":"auth/logout"}')).toEqual({ type: "auth/logout" })
  })

  it("모르는 type 은 무시한다", () => {
    expect(parseBridgeMessage('{"type":"cart/updated"}')).toBeNull()
  })

  it("JSON 이 아니면 무시한다", () => {
    expect(parseBridgeMessage("hello")).toBeNull()
  })

  it("type 이 없으면 무시한다", () => {
    expect(parseBridgeMessage('{"foo":1}')).toBeNull()
  })

  it("type 이 문자열이 아니면 무시한다", () => {
    expect(parseBridgeMessage('{"type":123}')).toBeNull()
  })
})
