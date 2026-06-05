// 메인 카테고리 고정 목록 (홈 베스트, 헤더 네비게이션 등에서 사용)
// id: Medusa product_category id
// key: 마이그레이션에 영향받지 않는 안정 슬러그. 사용자 선호값(쿠키/DB) 저장용.
export const FIXED_CATEGORIES = [
  {
    key: "lash-perm",
    id: "pcat_01KT8J0XYYYR0GGNSEG5XKHNZC",
    name: "속눈썹펌",
    handle: "cafe24-cat-246",
  },
  {
    key: "lash-extension",
    id: "pcat_01KT8J0XW61TT61Z8SVNTZXYS8",
    name: "속눈썹연장",
    handle: "cafe24-cat-247",
  },
  {
    key: "semi-permanent",
    id: "pcat_01KT8J0Y58AQY5WQJHTHRJKQJ1",
    name: "반영구",
    handle: "cafe24-cat-261",
  },
  {
    key: "nail",
    id: "pcat_01KT8J0Y04B5MTMRRTYQHVE6A1",
    name: "네일아트",
    handle: "cafe24-cat-28",
  },
  {
    key: "tattoo",
    id: "pcat_01KT8J0YPD4EE9P13FR36CVAX1",
    name: "타투",
    handle: "cafe24-cat-271",
  },
  {
    key: "skincare",
    id: "pcat_01KT8J0YG1NWJXZ4M9MT7R7PS0",
    name: "피부미용",
    handle: "cafe24-cat-278",
  },
  {
    key: "hair",
    id: "pcat_01KT8J0YK9NGQD5X5EMC0B2ZGR",
    name: "헤어",
    handle: "cafe24-cat-347",
  },
  {
    key: "waxing",
    id: "pcat_01KT8J0Y84WXFEAHRK9N98NE8T",
    name: "왁싱",
    handle: "cafe24-cat-267",
  },
  {
    key: "nomond",
    id: "pcat_01KT8J0ZPDR31T56CD8FZMN5ES",
    name: "노몬드",
    handle: "cafe24-cat-495",
  },
] as const

export type FixedCategory = (typeof FIXED_CATEGORIES)[number]

// 관심 카테고리 후보 (노몬드는 브랜드라 제외)
export const INTEREST_CANDIDATE_KEYS = [
  "lash-perm",
  "lash-extension",
  "semi-permanent",
  "nail",
  "tattoo",
  "skincare",
  "hair",
  "waxing",
] as const

export type InterestKey = (typeof INTEREST_CANDIDATE_KEYS)[number]

export const MAX_INTEREST_CATEGORIES = 3

// 후보 카테고리만 골라낸 배열 (선택 UI에서 사용)
export const INTEREST_CANDIDATE_CATEGORIES = FIXED_CATEGORIES.filter((c) =>
  (INTEREST_CANDIDATE_KEYS as readonly string[]).includes(c.key)
) as readonly Extract<FixedCategory, { key: InterestKey }>[]

export function isInterestKey(value: string): value is InterestKey {
  return (INTEREST_CANDIDATE_KEYS as readonly string[]).includes(value)
}

export function getCategoryByKey(key: string): FixedCategory | undefined {
  return FIXED_CATEGORIES.find((c) => c.key === key)
}
