import "server-only"
import { api } from "@/lib/api/api"
import { getAuthHeaders } from "@lib/data/cookies"
import { getMembershipSegmentHeader } from "@lib/data/membership-cache-tags"
import { TIME_SALE_TAG } from "@lib/data/cache-tags"
import type {
  MembershipHallQueryDto,
  MembershipHallResponseDto,
} from "@/lib/types/dto/membership-hall"
import type { MembershipHallResult } from "@/lib/types/ui/membership-hall"

export const MEMBERSHIP_HALL_TAG = "membership-hall"

const emptyResult = (query: MembershipHallQueryDto): MembershipHallResult => ({
  total: 0,
  limit: query.limit,
  offset: query.offset,
  productIds: [],
  counts: { all: 0, sale: 0, discount: 0 },
  categories: [],
  hasMembershipSale: false,
})

/**
 * 멤버십관 상품 id 와 탭·분야별 개수. 회원 전용 노출 상품은 회원에게만 오므로 고객 토큰을 붙이고,
 * 멤버십 상태를 캐시 키에 태워 가입·해지 직후 다른 버킷을 읽게 한다.
 * 세일 시작·종료는 타임세일 태그 무효화로 바로 반영되고, revalidate 는 그게 죽었을 때의 안전망이다.
 */
export async function getMembershipHall(
  query: MembershipHallQueryDto
): Promise<MembershipHallResult> {
  const params: Record<string, string> = {
    tab: query.tab,
    sort: query.sort,
    limit: String(query.limit),
    offset: String(query.offset),
  }

  if (query.category) params.category = query.category

  const [auth, segment] = await Promise.all([
    getAuthHeaders(),
    getMembershipSegmentHeader(),
  ])

  try {
    return await api<MembershipHallResponseDto>(
      "medusa",
      "/store/membership-hall",
      {
        method: "GET",
        withAuth: false,
        params,
        headers: { ...(auth ?? {}), ...segment },
        next: { tags: [MEMBERSHIP_HALL_TAG, TIME_SALE_TAG], revalidate: 60 },
      }
    )
  } catch (error) {
    console.error("[membership-hall] 조회 실패:", error)

    return emptyResult(query)
  }
}
