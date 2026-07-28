import "server-only"
import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { cache } from "react"

/**
 * 같은 요청 안에서 layout·page·generateMetadata 가 같은 카테고리를 조회한다.
 * `cache()` 로 묶어 왕복을 1회로 유지한다.
 */
export const getCategoryByHandleCached = cache(
  async (segments: string[]) => getCategoryByHandle(segments)
)
