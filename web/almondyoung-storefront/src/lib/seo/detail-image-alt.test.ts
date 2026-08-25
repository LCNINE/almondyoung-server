import { describe, expect, it } from "vitest"
import { withImageAlt } from "./detail-image-alt"

const alt = (index: number) => `루가 래쉬 밍크모 상세 이미지 ${index}`

describe("withImageAlt", () => {
  it("alt 없는 img 에 순번 alt 를 채운다", () => {
    const out = withImageAlt(
      '<img src="/a.jpg"><img src="/b.jpg">',
      alt
    )

    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 1"')
    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 2"')
  })

  it("이미 있는 alt 는 건드리지 않는다", () => {
    const out = withImageAlt('<img src="/a.jpg" alt="성분표">', alt)

    expect(out).toContain('alt="성분표"')
    expect(out).not.toContain("상세 이미지")
  })

  it("빈 alt 는 채운다", () => {
    const out = withImageAlt('<img src="/a.jpg" alt="">', alt)

    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 1"')
  })

  // sanitize-html 은 inline style 을 재직렬화해 공백을 없앤다(`margin: 0px auto` →
  // `margin:0px auto`). 선언이 사라지지 않는지만 본다.
  it("cafe24 이관본의 inline style 과 data 속성을 보존한다", () => {
    const out = withImageAlt(
      '<img src="/web/upload/NNEditor/20250117/1.jpg" data-result="success" data-name="1.jpg" data-size="1000px/1260px" style="display: block; float: none; vertical-align: top; margin: 0px auto; text-align: center; width: 1201px;">',
      alt
    )

    expect(out).toContain('src="/web/upload/NNEditor/20250117/1.jpg"')
    for (const attr of ["data-result", "data-name", "data-size"]) {
      expect(out).toContain(attr)
    }
    for (const prop of [
      "display",
      "float",
      "vertical-align",
      "margin",
      "text-align",
      "width",
    ]) {
      expect(out).toContain(prop)
    }
    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 1"')
  })

  it("img 가 없으면 내용을 바꾸지 않는다", () => {
    const out = withImageAlt("<p>본더입니다</p>", alt)

    expect(out).toBe("<p>본더입니다</p>")
  })

  it("순번은 alt 를 채운 것과 건너뛴 것을 통틀어 문서 순서를 따른다", () => {
    const out = withImageAlt(
      '<img src="/a.jpg"><img src="/b.jpg" alt="성분표"><img src="/c.jpg">',
      alt
    )

    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 1"')
    expect(out).toContain('alt="성분표"')
    expect(out).toContain('alt="루가 래쉬 밍크모 상세 이미지 3"')
  })
})
