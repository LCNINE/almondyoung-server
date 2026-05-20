import { CATEGORY_FALLBACK_THUMBNAILS } from "@/lib/constants/category-thumbnails"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

/**
 * 카테고리 썸네일을 동기적으로 구한다.
 * 1) metadata 의 이미지 필드(thumbnail/imageUrl/image_url/image)
 * 2) 하드코딩 폴백 맵(CATEGORY_FALLBACK_THUMBNAILS) — 자기 자신부터 하위 id 순으로 탐색
 *
 * 서버/클라이언트 어디서나 호출 가능(동기). file-service URL 변환은 getThumbnailUrl 로 별도 처리.
 * PIM API 기반 비동기 폴백이 필요하면 서버 컴포넌트에서 이 결과가 null 일 때만 추가로 시도한다.
 */
export function getCategoryThumbnail(
  category: StoreProductCategoryTree
): string | null {
  const metadata = category.metadata as
    | {
        thumbnail?: unknown
        imageUrl?: unknown
        image_url?: unknown
        image?: unknown
      }
    | null
    | undefined

  const metaImage =
    metadata?.thumbnail ??
    metadata?.imageUrl ??
    metadata?.image_url ??
    metadata?.image
  if (typeof metaImage === "string" && metaImage) return metaImage

  for (const id of collectCategoryIds(category)) {
    const hardcoded = CATEGORY_FALLBACK_THUMBNAILS[id]
    if (hardcoded) return hardcoded
  }

  return null
}
