// 메인 카테고리 고정 목록 (홈 베스트, 헤더 네비게이션 등에서 사용)
// id: Medusa product_category id
// key: 마이그레이션에 영향받지 않는 안정 슬러그. 사용자 선호값(쿠키/DB) 저장용.
export const FIXED_CATEGORIES = [
  {
    key: "lash-perm",
    id: "pcat_019c0c0d9b3677dc85395e40e8411453",
    name: "속눈썹펌",
    handle: "soknunsseoppeom",
  },
  {
    key: "lash-extension",
    id: "pcat_019c0c0d9b377356b4ef999a294d9dd2",
    name: "속눈썹연장",
    handle: "soknunsseopyeonjang",
  },
  {
    key: "semi-permanent",
    id: "pcat_019c0c0d9b38734abfd42633f3bed370",
    name: "반영구",
    handle: "banyeonggu",
  },
  {
    key: "nail",
    id: "pcat_019c0c0d9b38734abfd431dad85663f6",
    name: "네일아트",
    handle: "neilateu",
  },
  {
    key: "tattoo",
    id: "pcat_019c0c0d9b377356b4efdfcf2a3fd02d",
    name: "타투",
    handle: "tatu",
  },
  {
    key: "skincare",
    id: "pcat_019c0c0d9b377356b4f135c04d1af15a",
    name: "피부미용",
    handle: "pibumiyong",
  },
  {
    key: "hair",
    id: "pcat_019c0c0d9b377356b4f1522146205c90",
    name: "헤어",
    handle: "heeo",
  },
  {
    key: "waxing",
    id: "pcat_019c0c0d9b377356b4efcdf0669629e1",
    name: "왁싱",
    handle: "waksing",
  },
  {
    key: "nomond",
    id: "pcat_019c0c0d9b38734abfd34c0a584ffe35",
    name: "노몬드",
    handle: "nomondeu",
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
