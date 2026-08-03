// 어드민 상세설명 에디터가 저장하는 이미지 디렉티브 계약.
// 원본: packages/product-description/directive.ts (TS 소스 패키지라 스토어프론트 번들/노드 양쪽에서
// 그대로 import 하기 어려워 파서만 옮겨왔다. 계약이 바뀌면 두 곳을 같이 고쳐야 한다.)
const PRODUCT_IMAGE_DIRECTIVE_NAME = "product-image"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MarkdownNode = {
  type?: string
  name?: string
  attributes?: Record<string, unknown> | null
  children?: MarkdownNode[]
  url?: string
  alt?: string
  value?: string
}

/**
 * `::product-image{fileId=... alt=...}` 디렉티브를 일반 마크다운 이미지 노드로 바꾼다.
 */
export function remarkProductImageDirective(
  resolveUrl: (fileId: string) => string
) {
  return () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      const children = node.children
      if (!children) return

      children.forEach((child, index) => {
        const isDirective =
          child.type === "leafDirective" ||
          child.type === "textDirective" ||
          child.type === "containerDirective"

        if (isDirective && child.name === PRODUCT_IMAGE_DIRECTIVE_NAME) {
          const fileId = child.attributes?.fileId
          const alt = child.attributes?.alt
          // 깨진 디렉티브는 조용히 제거 — 스토어프론트엔 진단 UI 불필요
          children[index] =
            typeof fileId === "string" && UUID_RE.test(fileId)
              ? {
                  type: "image",
                  url: resolveUrl(fileId),
                  alt: typeof alt === "string" ? alt : "",
                }
              : { type: "text", value: "" }
        }

        walk(children[index])
      })
    }

    walk(tree)
  }
}
