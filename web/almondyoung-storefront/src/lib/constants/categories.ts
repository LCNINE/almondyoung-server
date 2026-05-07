// 메인 카테고리 고정 목록 (홈 베스트, 헤더 네비게이션 등에서 사용)
// id: Medusa product_category id
// key: 마이그레이션에 영향받지 않는 안정 슬러그. 사용자 선호값(쿠키/DB) 저장용.
export const FIXED_CATEGORIES = [
  {
    key: "lash-perm",
    id: "pcat_01KQRPDVFSN0FAZKPZAJ9XQ2HD",
    name: "속눈썹펌",
    handle: "cafe24-cat-246",
  },
  {
    key: "lash-extension",
    id: "pcat_01KQRPEJ1G70YQQFYSK0QJ7NQD",
    name: "속눈썹연장",
    handle: "cafe24-cat-247",
  },
  {
    key: "semi-permanent",
    id: "pcat_01KQRPFCA5TRFFRV9Y7DKJAECY",
    name: "반영구",
    handle: "cafe24-cat-261",
  },
  {
    key: "nail",
    id: "pcat_01KQRPHN8A45F2FZCA745A40VA",
    name: "네일아트",
    handle: "cafe24-cat-28",
  },
  {
    key: "tattoo",
    id: "pcat_01KQRPGBFER3G9D67J4DREZZGJ",
    name: "타투",
    handle: "cafe24-cat-271",
  },
  {
    key: "skincare",
    id: "pcat_01KQRPGZJSY3PSD3VPRMXS25TW",
    name: "피부미용",
    handle: "cafe24-cat-278",
  },
  {
    key: "hair",
    id: "pcat_01KQRPVNYTMFNDFMCH3B5FSSX0",
    name: "헤어",
    handle: "cafe24-cat-347",
  },
  {
    key: "waxing",
    id: "pcat_01KQRPG0QA0JWWPMSPN6206ZGQ",
    name: "왁싱",
    handle: "cafe24-cat-267",
  },
  {
    key: "nomond",
    id: "pcat_01KQRQ7Q408S2CQ14Z8DKRN1JS",
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
