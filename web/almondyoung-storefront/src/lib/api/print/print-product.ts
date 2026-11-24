"use server"

import { PRINT_PRODUCTS } from "@/domains/almond-template/lib/catalog"
import { templateProductOf } from "@/domains/almond-template/lib/template-product"
import type { AlmondTemplateSummaryDto } from "@/lib/types/dto/almond-template"
import { api } from "../api"

// 템플릿으로 게시한 주문제작 인쇄 상품(PIM 상품 id). 이런 상품은 시안이나 고객 파일을 붙여야 해서 상품 카드에서 바로 담지 않는다.
// 목록은 1분 캐시한다(막 게시한 상품은 1분 늦게 막힌다). 못 받으면 던진다 — 부르는 쪽이 막지 않고 넘어가며 다음에 다시 받는다
export async function listMadeToOrderPrintMasterIds(): Promise<string[]> {
  const templates = await api<AlmondTemplateSummaryDto[]>(
    "ugc",
    `/almond-templates`,
    {
      method: "GET",
      withAuth: false,
      next: { revalidate: 60 },
    }
  )

  const ids = templates
    .map((template) => template.productId)
    .filter(
      (id) => !(id in PRINT_PRODUCTS) && !!templateProductOf(id, templates)
    )

  return Array.from(new Set(ids))
}
