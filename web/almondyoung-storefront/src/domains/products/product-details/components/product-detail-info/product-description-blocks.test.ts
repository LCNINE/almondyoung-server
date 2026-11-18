import { remarkProductDescription } from "@packages/product-description/remark-blocks"
import remarkDirective from "remark-directive"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { describe, expect, it } from "vitest"

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const FILE = "019f890e-dec0-7060-a32e-024c3e47c6be"

async function render(markdown: string): Promise<HastNode> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkProductDescription({ resolveImageUrl: (id) => `https://files.test/${id}` }))
    .use(remarkRehype)

  return (await processor.run(processor.parse(markdown))) as HastNode
}

function all(node: HastNode, match: (n: HastNode) => boolean): HastNode[] {
  const self = match(node) ? [node] : []

  return [...self, ...(node.children ?? []).flatMap((child) => all(child, match))]
}

const hasClass = (name: string) => (n: HastNode) =>
  Array.isArray(n.properties?.className) && n.properties.className.includes(name)

const textOf = (node: HastNode): string =>
  node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("")

describe("상세설명 블록 렌더", () => {
  it("이미지 지시문은 img 로, 깨진 지시문은 지운다", async () => {
    const tree = await render(`::product-image{fileId="${FILE}" alt="상세컷"}\n\n::product-image{alt="fileId 없음"}`)
    const imgs = all(tree, (n) => n.tagName === "img")

    expect(imgs).toHaveLength(1)
    expect(imgs[0].properties).toMatchObject({ src: `https://files.test/${FILE}`, alt: "상세컷" })
  })

  it("crop 은 data-crop 으로 넘기고, 잘못된 crop 은 버린다", async () => {
    const tree = await render(
      `::product-image{fileId="${FILE}" crop="0.3,0.4,0.1,0.1"}\n\n::product-image{fileId="${FILE}" crop="0.9,0,0.5,0.5"}`
    )
    const imgs = all(tree, (n) => n.tagName === "img")

    expect(imgs[0].properties?.dataCrop).toBe("0.3,0.4,0.1,0.1")
    expect(imgs[1].properties?.dataCrop).toBeUndefined()
  })

  it("블록은 not-prose section 으로 감싸고 제목 속성을 진짜 제목으로 넣는다", async () => {
    const tree = await render(':::checks{title="이런 분께 추천해요"}\n- **마블 아트** 젤 하나로 마블\n:::')
    const [section] = all(tree, hasClass("pd-checks"))

    expect(section.tagName).toBe("section")
    expect(section.properties?.className).toEqual(["not-prose", "pd-block", "pd-checks"])
    expect(all(section, (n) => n.tagName === "h3").map(textOf)).toEqual(["이런 분께 추천해요"])
    expect(all(section, (n) => n.tagName === "strong").map(textOf)).toEqual(["마블 아트"])
  })

  it("cover 는 사진·키커·제목을 갖고, compare 는 이미지 두 장을 한 격자로 묶는다", async () => {
    const tree = await render(
      [
        `:::cover{fileId="${FILE}" kicker="MU:A"}`,
        "## 하나의 젤로",
        ":::",
        "",
        ':::compare{label="CHECK!"}',
        "### 마블",
        `::product-image{fileId="${FILE}" crop="0,0,0.5,0.5"}`,
        `::product-image{fileId="${FILE}"}`,
        ":::",
      ].join("\n")
    )

    const [cover] = all(tree, hasClass("pd-cover"))
    expect(all(cover, hasClass("pd-cover-img"))).toHaveLength(1)
    expect(all(cover, hasClass("pd-kicker")).map(textOf)).toEqual(["MU:A"])
    expect(all(cover, (n) => n.tagName === "h2").map(textOf)).toEqual(["하나의 젤로"])

    const [duo] = all(tree, hasClass("pd-duo"))
    expect(all(duo, (n) => n.tagName === "img")).toHaveLength(2)
    expect(all(tree, hasClass("pd-label")).map(textOf)).toEqual(["CHECK!"])
  })

  it("details 의 swatch 는 figure 격자로 묶고, 이름 없는 swatch 는 버린다", async () => {
    const tree = await render(
      [
        ':::details{title="DETAILS" subtitle="컬러 자세히 보기"}',
        `::swatch{fileId="${FILE}" crop="0.3,0.4,0.1,0.1" code="MG04" name="문 펄"}`,
        `::swatch{fileId="${FILE}" code="MG05"}`,
        ":::",
      ].join("\n")
    )

    const [grid] = all(tree, hasClass("pd-swatches"))
    const figures = all(grid, (n) => n.tagName === "figure")

    expect(figures).toHaveLength(1)
    expect(all(figures[0], (n) => n.tagName === "figcaption").map(textOf)).toEqual(["MG04 문 펄"])
    expect(all(figures[0], (n) => n.tagName === "img")[0].properties).toMatchObject({ alt: "문 펄", dataCrop: "0.3,0.4,0.1,0.1" })
  })

  it("콜론이 든 평범한 글자(MU:A, 10:30)는 지시문으로 먹히지 않고 그대로 남는다", async () => {
    const tree = await render(':::spec{title="상품 정보"}\n- **브랜드** MU:A\n:::\n\n오후 10:30 마감')

    expect(all(tree, (n) => n.tagName === "li").map(textOf)).toEqual(["브랜드 MU:A"])
    expect(all(tree, (n) => n.tagName === "p").map(textOf)).toContain("오후 10:30 마감")
  })

  it("steps 는 제목과 번호 목록을 가진 section 이다", async () => {
    const tree = await render(':::steps{title="사용 방법"}\n1. 리무버를 발라요\n2. 밀어 줘요\n:::')
    const [section] = all(tree, hasClass("pd-steps"))

    expect(all(section, (n) => n.tagName === "h3").map(textOf)).toEqual(["사용 방법"])
    expect(all(section, (n) => n.tagName === "li").map(textOf)).toEqual(["리무버를 발라요", "밀어 줘요"])
  })

  it("모델이 따옴표를 빼먹은 crop 속성도 읽고, 격자 칸 비율을 붙인다", async () => {
    const tree = await render(
      [
        ':::details{title="DETAILS"}',
        `::swatch{fileId="${FILE}" crop=0.316,0.425,0.081,0.275 code="MG04" name="문 펄"}`,
        ":::",
      ].join("\n")
    )
    const [img] = all(tree, (n) => n.tagName === "img")

    expect(img.properties).toMatchObject({ dataCrop: "0.316,0.425,0.081,0.275", dataAspect: "0.6" })
  })

  it("문단 안의 :swatch 는 figure 로 바꾸지 않고 글자로 남긴다", async () => {
    const tree = await render(`본문 :swatch{fileId="${FILE}" name="빨강"} 계속`)

    expect(all(tree, (n) => n.tagName === "figure")).toHaveLength(0)
    expect(all(tree, (n) => n.tagName === "p").map(textOf)[0]).toContain("본문 :swatch")
  })

  it("invalidImage 옵션을 주면 깨진 이미지를 지우지 않고 그 노드로 바꾼다 (어드민 진단용)", async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkDirective)
      .use(
        remarkProductDescription({
          resolveImageUrl: (id) => `https://files.test/${id}`,
          invalidImage: ({ fileId, reason }) => ({ type: "text", value: `깨짐:${fileId ?? "없음"}:${reason}` }),
        })
      )
      .use(remarkRehype)
    const tree = (await processor.run(
      processor.parse('::product-image{alt="x"}\n\n::product-image{fileId="nope"}')
    )) as HastNode

    expect(textOf(tree)).toContain("깨짐:없음:missing_file_id")
    expect(textOf(tree)).toContain("깨짐:nope:invalid_file_id")
  })

  it("블록이 없는 옛 상세설명은 그대로 그린다", async () => {
    const tree = await render("## 제품 특징\n\n본문이에요.")

    expect(all(tree, hasClass("pd-block"))).toHaveLength(0)
    expect(all(tree, (n) => n.tagName === "h2").map(textOf)).toEqual(["제품 특징"])
  })
})
