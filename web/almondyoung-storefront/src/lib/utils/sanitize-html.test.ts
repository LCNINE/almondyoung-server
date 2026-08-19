import { describe, expect, it } from "vitest"
import { sanitizeNoticeHtml } from "./sanitize-html"

describe("sanitizeNoticeHtml", () => {
  it("허용 태그와 이미지 크기 속성을 보존한다", () => {
    const html = '<p>본문</p><img src="https://x.test/a.jpg" width="154" height="100" />'
    expect(sanitizeNoticeHtml(html)).toBe(html)
  })

  it("제로폭 공백만 있는 빈 문단을 지우지 않는다", () => {
    expect(sanitizeNoticeHtml("<p>​</p>")).toBe("<p>​</p>")
  })

  it("script 와 on* 핸들러를 제거한다", () => {
    const out = sanitizeNoticeHtml('<p onclick="steal()">글</p><script>steal()</script>')
    expect(out).not.toContain("script")
    expect(out).not.toContain("onclick")
  })

  it("javascript: 스킴을 제거한다", () => {
    expect(sanitizeNoticeHtml('<a href="javascript:alert(1)">링크</a>')).not.toContain(
      "javascript:"
    )
  })

  it("외부 링크에 target/rel 을 강제한다", () => {
    const out = sanitizeNoticeHtml('<a href="https://x.test">링크</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })
})
