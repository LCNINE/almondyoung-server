import { PRINT_PRODUCTS, PRINT_SPECS, type PrintKind } from "./catalog"

export type TemplateProduct = {
  productId: string
  kind: PrintKind
  title: string
}

function printKindOf(value?: string | null): PrintKind | undefined {
  return Object.keys(PRINT_SPECS).find(
    (key): key is PrintKind => key === value
  )
}

// 고정 상품이면 공개 템플릿 목록 없이도 판단이 끝난다
export function needsTemplateList(productId: string) {
  return !PRINT_PRODUCTS[productId]
}

// 고정 상품이 먼저, 없으면 공개 템플릿이 가리키는 상품(아몬드템플릿에서 게시한 상품)
export function templateProductOf(
  productId: string,
  templates: { productId: string; kind?: string | null; title: string }[]
): TemplateProduct | undefined {
  const fixed = PRINT_PRODUCTS[productId]
  if (fixed) return { productId, kind: fixed.kind, title: fixed.title }

  for (const item of templates) {
    if (item.productId !== productId) continue
    const kind = printKindOf(item.kind)
    if (kind) return { productId, kind, title: item.title }
  }

  return undefined
}
