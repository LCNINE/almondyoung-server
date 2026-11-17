import { describe, expect, it } from "vitest"

import {
  isExternalNoticeLink,
  nextNoticeIndex,
  noticeItemState,
} from "./top-notice-bar.helpers"

describe("nextNoticeIndex", () => {
  it("끝에 닿으면 처음으로 돌아간다", () => {
    expect(nextNoticeIndex(0, 3)).toBe(1)
    expect(nextNoticeIndex(2, 3)).toBe(0)
  })

  it("공지가 없으면 0 을 준다", () => {
    expect(nextNoticeIndex(0, 0)).toBe(0)
  })
})

describe("noticeItemState", () => {
  it("지금·떠나는·대기 공지를 구분한다", () => {
    expect(noticeItemState(1, 1, 0)).toBe("current")
    expect(noticeItemState(0, 1, 0)).toBe("leave")
    expect(noticeItemState(2, 1, 0)).toBe("enter")
  })

  it("전환이 끝나 leaving 이 비면 떠난 공지는 아래에서 대기한다", () => {
    expect(noticeItemState(0, 1, null)).toBe("enter")
  })
})

describe("isExternalNoticeLink", () => {
  it("http(s) 절대 주소만 외부 링크로 본다", () => {
    expect(isExternalNoticeLink("https://example.com/a")).toBe(true)
    expect(isExternalNoticeLink(" HTTP://example.com")).toBe(true)
    expect(isExternalNoticeLink("/cs/notice/1")).toBe(false)
  })
})
