import {
  addToRecentViews,
  getRecentViews,
  removeFromRecentViews,
} from "@lib/api/users/recent-views"
import { RecentViewDto } from "@lib/types/dto/users"
import { RecentViewProductThumbnail } from "@lib/types/ui/product"
import { getPimProductDetail, getAllProductList } from "@lib/api/pim/pim-api"
import { toRecentViewProductThumbnail } from "@lib/utils/transformers/user.transformer"

// 서비스 옵션 타입
export interface RecentViewsServiceOpts {
  /** 사용자 ID */
  userId?: string
  /** 상품 상세 정보 포함 여부 */
  withProductDetails?: boolean
  /** 캐시 사용 여부 */
  useCache?: boolean
}

// 캐시 타입
type CachedRecentViews = {
  items: RecentViewProductThumbnail[]
  lastFetched: number
  userId: string
}

const getCacheKey = (userId: string) => `recent_views_${userId}`
const CACHE_TTL = 5 * 60 * 1000 // 5분

function readCache(userId: string): CachedRecentViews | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem(getCacheKey(userId))
    if (!cached) return null
    const data = JSON.parse(cached) as CachedRecentViews
    if (Date.now() - data.lastFetched > CACHE_TTL) {
      localStorage.removeItem(getCacheKey(userId))
      return null
    }
    return data
  } catch {
    return null
  }
}

function writeCache(userId: string, items: RecentViewProductThumbnail[]): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(
      getCacheKey(userId),
      JSON.stringify({
        items,
        lastFetched: Date.now(),
        userId,
      })
    )
  } catch {}
}

// 최근 본 상품에 상품 정보 결합 (개선: 한 번의 API 호출로 모든 상품 정보 가져오기)
async function enrichWithProductInfo(
  recentViews: RecentViewProductThumbnail[]
): Promise<RecentViewProductThumbnail[]> {
  console.log(
    `🔍 [enrichWithProductInfo] 시작: ${recentViews.length}개 상품 처리`
  )
  const startTime = performance.now()

  // 각 상품을 개별 호출하는 대신, 한 번의 큰 요청으로 많은 상품을 가져온 후 필터링
  const productIds = recentViews.map((rv) => rv.productId).filter(Boolean)

  if (productIds.length === 0) {
    return recentViews
  }

  try {
    console.log(`🚀 PIM API 일괄 조회 시작: ${productIds.length}개 상품`)

    // 모든 상품 정보를 한 번에 가져오기 (충분히 큰 limit 설정)
    const productMap = new Map<string, any>()

    // 방법 1: 개별 호출 (기존 방식 유지 - 병렬 처리)
    // 방법 2: 배치 API가 있다면 사용

    // 현재는 개별 호출을 병렬로 처리
    const enrichProduct = async (
      recentView: RecentViewProductThumbnail,
      index: number
    ): Promise<RecentViewProductThumbnail> => {
      const productId = recentView.productId

      if (!productId) {
        console.warn(
          "❌ [enrichWithProductInfo] productId를 찾을 수 없음:",
          recentView
        )
        return {
          productId: "unknown",
          viewedAt: recentView.viewedAt,
          thumbnail: "",
        }
      }

      const itemStartTime = performance.now()
      try {
        const pimStartTime = performance.now()
        console.log(
          `  🔄 [${index}/${recentViews.length}] PIM API 호출 시작: ${productId}`
        )

        try {
          const pimProduct = await getPimProductDetail(productId)
          const pimDuration = Math.round(performance.now() - pimStartTime)
          console.log(
            `  ✓ [${index}/${recentViews.length}] PIM API 완료: ${productId} (${pimDuration}ms)`
          )

          const thumbnail =
            pimProduct.thumbnail ||
            pimProduct.images?.primary ||
            (pimProduct.images?.additional &&
              pimProduct.images.additional[0]) ||
            ""

          const totalDuration = Math.round(performance.now() - itemStartTime)
          console.log(
            `  ✅ [${index}/${recentViews.length}] 완료: ${productId} (총 ${totalDuration}ms)`
          )

          return {
            productId,
            viewedAt: recentView.viewedAt,
            thumbnail,
          }
        } catch (apiError) {
          const errorDuration = Math.round(performance.now() - itemStartTime)
          console.error(
            `  ❌ [${index}/${recentViews.length}] PIM API 호출 실패: ${productId} (${errorDuration}ms):`,
            apiError
          )
          // PIM API 호출 실패 시 기본 썸네일 반환
          return {
            productId,
            viewedAt: recentView.viewedAt,
            thumbnail: "",
          }
        }
      } catch (error) {
        const errorDuration = Math.round(performance.now() - itemStartTime)
        console.error(
          `  ❌ [${index}/${recentViews.length}] 상품 정보 가져오기 실패: ${productId} (${errorDuration}ms):`,
          error
        )
        return {
          productId,
          viewedAt: recentView.viewedAt,
          thumbnail: "",
        }
      }
    }

    const enrichedViews = await Promise.all(
      recentViews.map((recentView, index) =>
        enrichProduct(recentView, index + 1)
      )
    )

    const totalDuration = Math.round(performance.now() - startTime)
    const avgTime = Math.round(totalDuration / recentViews.length)
    console.log(`\n✅ [enrichWithProductInfo] 전체 완료:`)
    console.log(`  - 총 소요: ${totalDuration}ms`)
    console.log(`  - 상품 수: ${recentViews.length}개`)
    console.log(`  - 평균 시간: ${avgTime}ms/상품`)
    console.log(`  - 병렬 처리로 가장 느린 상품 대기: ${totalDuration}ms`)

    return enrichedViews
  } catch (error) {
    console.error(`❌ [enrichWithProductInfo] 전체 에러:`, error)
    return recentViews
  }
}

/**
 * 최근 본 상품 목록 조회 서비스
 */
export async function getRecentViewsService(
  limit: number = 10,
  opts?: RecentViewsServiceOpts
): Promise<RecentViewProductThumbnail[]> {
  const totalStartTime = performance.now()

  // 캐시 먼저 확인
  if (opts?.useCache && opts?.userId) {
    const cached = readCache(opts.userId)
    if (cached) {
      console.log(
        `📦 캐시에서 조회 (${cached.items.length}개, ${Math.round((Date.now() - cached.lastFetched) / 1000)}초 전 캐시)`
      )
      return cached.items.slice(0, limit)
    }
  }

  try {
    // 1단계: User API 호출
    const step1Start = performance.now()
    console.log(`🚀 [단계 1] User API 호출 시작...`)
    const dtos = await getRecentViews(limit)
    const step1Duration = Math.round(performance.now() - step1Start)
    console.log(
      `✅ [단계 1] User API 호출 완료: ${step1Duration}ms (${dtos.length}개)`
    )

    // 2단계: DTO → UI 타입 변환
    const step2Start = performance.now()
    console.log(`🚀 [단계 2] DTO → UI 변환 시작...`)
    const uiItems = dtos.map(toRecentViewProductThumbnail)
    const step2Duration = Math.round(performance.now() - step2Start)
    console.log(`✅ [단계 2] DTO → UI 변환 완료: ${step2Duration}ms`)

    // 3단계: PIM API로 썸네일 채우기
    const step3Start = performance.now()
    console.log(`🚀 [단계 3] PIM API로 썸네일 채우기 시작...`)

    // 🎯 최적화: 썸네일이 있는지 먼저 확인 (빈 문자열이 아니면 이미 채워진 것)
    const needsEnrichment = uiItems.some(
      (item) => !item.thumbnail || item.thumbnail.trim() === ""
    )

    let enrichedItems: RecentViewProductThumbnail[]
    if (!needsEnrichment && uiItems.length > 0 && uiItems[0].thumbnail) {
      console.log(`⚡ [단계 3] 썸네일 이미 있음, PIM API 스킵`)
      enrichedItems = uiItems
    } else {
      enrichedItems = await enrichWithProductInfo(uiItems)
    }

    const step3Duration = Math.round(performance.now() - step3Start)
    console.log(`✅ [단계 3] PIM API 썸네일 채우기 완료: ${step3Duration}ms`)

    // 캐시 저장
    if (opts?.useCache && opts?.userId) {
      writeCache(opts.userId, enrichedItems)
    }

    const totalDuration = Math.round(performance.now() - totalStartTime)
    console.log(`\n📊 [전체 성능 분석]`)
    console.log(
      `  - User API: ${step1Duration}ms (${Math.round((step1Duration / totalDuration) * 100)}%)`
    )
    console.log(
      `  - 변환: ${step2Duration}ms (${Math.round((step2Duration / totalDuration) * 100)}%)`
    )
    console.log(
      `  - PIM API: ${step3Duration}ms (${Math.round((step3Duration / totalDuration) * 100)}%)`
    )
    console.log(`  - 총 소요: ${totalDuration}ms`)

    return enrichedItems
  } catch (error) {
    const errorDuration = Math.round(performance.now() - totalStartTime)
    console.error(
      `❌ [getRecentViewsService] 에러 (${errorDuration}ms):`,
      error
    )
    return []
  }
}

/**
 * 최근 본 상품 추가 서비스
 */
export async function addToRecentViewsService(
  productId: string,
  opts?: RecentViewsServiceOpts
): Promise<RecentViewProductThumbnail> {
  try {
    console.log("📝 [addToRecentViewsService] 시작:", { productId, opts })

    const result = await addToRecentViews(productId)
    console.log("📝 [addToRecentViewsService] API 결과:", result)

    // API가 성공 메시지만 반환하는 경우, 임시 RecentViewDto 생성
    let recentViewDto: RecentViewDto
    if (typeof result === "string" || (result && "message" in result)) {
      // 성공 메시지만 반환된 경우, 임시 DTO 생성
      recentViewDto = {
        id: `temp-${Date.now()}`, // 임시 ID
        userId: opts?.userId || "unknown",
        productId: productId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      console.log("📝 [addToRecentViewsService] 임시 DTO 생성:", recentViewDto)
    } else {
      // 정상적인 DTO가 반환된 경우
      recentViewDto = result as RecentViewDto
    }

    // DTO -> UI 타입 변환
    const uiItem = toRecentViewProductThumbnail(recentViewDto)

    // 상품 정보와 결합 (썸네일 채우기)
    const enrichedResult = await enrichWithProductInfo([uiItem])
    const enrichedItem = enrichedResult[0]

    console.log("최근본 상품 추가 서비스 result", enrichedItem)
    return enrichedItem
  } catch (error) {
    console.error("❌ [addToRecentViewsService] 에러:", error)
    throw error
  }
}

/**
 * 최근 본 상품 제거 서비스
 */
export async function removeFromRecentViewsService(
  recentViewId: string,
  opts?: RecentViewsServiceOpts
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await removeFromRecentViews(recentViewId)
    return result
  } catch (error) {
    console.error("❌ [removeFromRecentViewsService] 에러:", error)
    throw error
  }
}

/**
 * 최근 본 상품 캐시 초기화 (현재 사용 안 함)
 */
export function clearRecentViewsCache(userId: string): void {
  // 캐시 로직 제거됨
}

/**
 * 최근 본 상품이 있는지 확인 (현재 사용 안 함)
 */
export function hasRecentViews(userId: string): boolean {
  // 캐시 로직 제거됨
  return false
}
