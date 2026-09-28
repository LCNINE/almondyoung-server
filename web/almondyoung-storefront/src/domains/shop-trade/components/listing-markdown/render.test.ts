import { createShopListingMarkdownOptions } from "@packages/shop-listing-markdown"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { describe, expect, it } from "vitest"

const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks })
const render = (content: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, options, content))

describe("샵 매매 마크다운 렌더 (spec §8.1)", () => {
  it("본문 이미지는 그리지 않는다", () => {
    expect(render("앞 ![사진](https://a.b/c.png) 뒤")).not.toContain("<img")
  })

  it("원시 HTML 은 실행되지 않고 글자로 보인다", () => {
    const html = render("<script>alert(1)</script>")
    expect(html).not.toContain("<script")
    expect(html).toContain("&lt;script&gt;")
  })

  it("javascript: 링크는 무력화된다", () => {
    expect(render("[눌러](javascript:alert(1))")).not.toContain("javascript:")
  })

  it("링크에 rel 이 붙는다 (자동 링크 포함)", () => {
    expect(render("[지도](https://map.x)")).toContain(
      'rel="nofollow ugc noopener"'
    )
    expect(render("https://open.kakao.com/o/abc")).toContain(
      'rel="nofollow ugc noopener"'
    )
  })

  it("tel: 링크는 살린다", () => {
    expect(render("[전화](tel:01012345678)")).toContain('href="tel:01012345678"')
  })

  it("단일 줄바꿈을 <br> 로 그린다 (remark-breaks)", () => {
    expect(render("한 줄\n두 줄")).toContain("<br/>")
  })
})
