import {
  FIXED_CATEGORIES,
  INTEREST_CANDIDATE_KEYS,
} from "@/lib/constants/categories"
import type {
  MembershipHallCategoryCount,
  MembershipHallSort,
  MembershipHallTab,
} from "@/lib/types/ui/membership-hall"

export const MEMBERSHIP_HALL_PATH = "/membership-hall"
export const MEMBERSHIP_HALL_PAGE_SIZE = 40

export const HALL_TABS: MembershipHallTab[] = ["all", "sale", "discount"]
export const HALL_SORTS: MembershipHallSort[] = ["sales", "discount", "newest"]

export type HallFieldKey = (typeof INTEREST_CANDIDATE_KEYS)[number]

export type HallState = {
  tab: MembershipHallTab
  sort: MembershipHallSort
  /** 분야 키(`FIXED_CATEGORIES.key`). null 이면 전체 */
  field: HallFieldKey | null
  page: number
}

export type HallSearchParams = {
  tab?: string
  sort?: string
  category?: string
  page?: string
}

const pick = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T => allowed.find((item) => item === value) ?? fallback

export function parseHallState(params: HallSearchParams): HallState {
  const page = Number(params.page)

  return {
    tab: pick(params.tab, HALL_TABS, "all"),
    sort: pick(params.sort, HALL_SORTS, "sales"),
    field: INTEREST_CANDIDATE_KEYS.find((key) => key === params.category) ?? null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

/** 탭·분야·정렬이 바뀌면 1페이지로 돌린다. 기본값은 주소에 싣지 않는다 */
export function hallHref(state: HallState, change: Partial<HallState>): string {
  const next = { ...state, ...change }
  const resetsPage =
    change.tab !== undefined ||
    change.sort !== undefined ||
    change.field !== undefined
  const page = resetsPage && change.page === undefined ? 1 : next.page
  const params = new URLSearchParams()

  if (next.tab !== "all") params.set("tab", next.tab)
  if (next.field) params.set("category", next.field)
  if (next.sort !== "sales") params.set("sort", next.sort)
  if (page > 1) params.set("page", String(page))

  const query = params.toString()

  return query ? `${MEMBERSHIP_HALL_PATH}?${query}` : MEMBERSHIP_HALL_PATH
}

export const fieldHandle = (key: HallFieldKey): string =>
  FIXED_CATEGORIES.find((category) => category.key === key)?.handle ?? key

/** 메인 카테고리 줄과 같은 8개 분야 중 지금 탭에 상품이 있는 것만, 고정 순서로 */
export function visibleHallFields(
  categories: MembershipHallCategoryCount[]
): HallFieldKey[] {
  const handles = new Set(
    categories.filter((category) => category.count > 0).map((c) => c.handle)
  )

  return INTEREST_CANDIDATE_KEYS.filter((key) => handles.has(fieldHandle(key)))
}

export const totalPages = (total: number) =>
  Math.max(1, Math.ceil(total / MEMBERSHIP_HALL_PAGE_SIZE))
