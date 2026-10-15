import { describe, expect, it } from "vitest"
import { optimizeDescriptionHtmlImages } from "./description-html-images"

describe("optimizeDescriptionHtmlImages", () => {
  it("허용 호스트 이미지는 최적화 주소와 srcset 으로 바꾸고 늦게 받는다", () => {
    const src =
      "https://almondyoung-demo.s3.ap-northeast-2.amazonaws.com/products/description-image/a.jpg"
    const out = optimizeDescriptionHtmlImages(`<p><img src="${src}" style="display:block"></p>`)

    expect(out).toContain('loading="lazy"')
    expect(out).toContain(`src="/_next/image?url=${encodeURIComponent(src)}&amp;w=`)
    expect(out).toContain('srcset="/_next/image?')
    expect(out).toContain('style="display:block"')
    expect(out).not.toContain(`src="${src}"`)
  })

  it("허용되지 않은 호스트는 주소를 건드리지 않는다 — 최적화기가 400 을 낸다", () => {
    const src = "https://ecimg.cafe24img.com/a.jpg"
    const out = optimizeDescriptionHtmlImages(`<img src="${src}">`)

    expect(out).toBe(`<img loading="lazy" decoding="async" src="${src}">`)
  })

  it("이미 loading 이 지정된 태그는 그 값을 따른다", () => {
    const out = optimizeDescriptionHtmlImages('<img loading="eager" src="https://x.test/a.jpg">')

    expect(out).toBe('<img loading="eager" src="https://x.test/a.jpg">')
  })
})
