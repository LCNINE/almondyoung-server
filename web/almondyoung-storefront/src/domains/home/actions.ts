"use server"

import type { HttpTypes } from "@medusajs/types"
import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { listProducts, listProductsSorted } from "@/lib/api/medusa/products"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

type Params = {
  handle: string
  regionId?: string
  limit?: number
}

// 자사(PB) 상품 고정 노출. key = 탭 카테고리 handle, value = Medusa product handle.
// 리뷰순에서 밀리더라도 이 상품만은 PB_PIN_SLOT 자리로 끌어올린다.
const PB_PINS: Record<string, string> = {
  // 속눈썹펌 / 노몬드 속눈썹펌 롯드 04
  "cafe24-cat-246": "ed9005ea-f428-48ec-9da9-d4c654278b9c",
  // 네일아트 / 노몬드 네일 퓨어 아세톤 1L
  "cafe24-cat-28": "bf8d85cb-cafc-469a-be92-702b7136a923",
  // 속눈썹연장 / 노몬드 아이패치 50개입
  "cafe24-cat-247": "f4816f45-a68b-41fb-b53d-778ea20dd288",
  // 반영구 / 노몬드 엠보 & 수지 니들
  "cafe24-cat-261": "cf49c165-0da7-4a18-9719-f0d38b8c312f",
  // 노몬드 / 노몬드 긴 마이크로 브러쉬 100p
  "cafe24-cat-495": "bb8f3bba-b0ee-4af7-a40a-3be63ac4f3f3",
}

// 0-based. 최소 보장 자리 — 이보다 아래면 2등 자리로 끌어올리고, 이미 더 위면 그대로 둔다.
const PB_PIN_SLOT = 1

/**
 * 카테고리별 베스트 상품 목록. 리뷰 많은 순 정렬.
 * 마진순 정렬은 원가(product_master_versions.supply_price)를 Core→Medusa 정렬
 * 인덱스로 내려야 가능. 그 전까진 리뷰수를 베스트 기준으로 쓴다.
 */
export async function getBestProductsByCategory({
  handle,
  regionId,
  limit = 10,
}: Params): Promise<HttpTypes.StoreProduct[]> {
  const category = await getCategoryByHandle([handle])

  // 카테고리를 못 찾으면(비활성/삭제) 빈 목록. category_id 를 빼고 조회하면
  // 필터가 통째로 무시돼 전 카테고리 상품이 섞여 나온다.
  if (!category) {
    return []
  }

  const {
    response: { products },
  } = await listProductsSorted({
    categoryId: collectCategoryIds(category),
    sortBy: "review_count",
    order: "desc",
    limit,
    regionId,
  })

  const pinHandle = PB_PINS[handle]
  if (!pinHandle) {
    return products
  }

  // 이미 상위권이면 추가 조회 없이 자리만 옮긴다.
  const pinned =
    products.find((p) => p.handle === pinHandle) ??
    (
      await listProducts({
        queryParams: { handle: pinHandle, limit: 1 },
        regionId,
      })
    ).response.products[0]

  if (!pinned) {
    return products
  }

  // 이미 PB_PIN_SLOT 이상 상위(1위 포함)면 끌어내리지 않는다.
  const currentIndex = products.findIndex((p) => p.id === pinned.id)
  if (currentIndex !== -1 && currentIndex <= PB_PIN_SLOT) {
    return products
  }

  const rest = products.filter((p) => p.id !== pinned.id)
  return [
    ...rest.slice(0, PB_PIN_SLOT),
    pinned,
    ...rest.slice(PB_PIN_SLOT),
  ].slice(0, limit)
}
