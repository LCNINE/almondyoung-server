// 메인 카테고리 고정 목록 (홈 베스트, 헤더 네비게이션 등에서 사용)
export const FIXED_CATEGORIES = [
  {
    id: "pcat_019c0c0d9b3677dc85395e40e8411453",
    name: "속눈썹펌",
    handle: "soknunsseoppeom",
  },
  {
    id: "pcat_019c0c0d9b377356b4ef999a294d9dd2",
    name: "속눈썹연장",
    handle: "soknunsseopyeonjang",
  },
  {
    id: "pcat_019c0c0d9b38734abfd42633f3bed370",
    name: "반영구",
    handle: "banyeonggu",
  },
  {
    id: "pcat_019c0c0d9b38734abfd431dad85663f6",
    name: "네일아트",
    handle: "neilateu",
  },
  {
    id: "pcat_019c0c0d9b377356b4efdfcf2a3fd02d",
    name: "타투",
    handle: "tatu",
  },
  {
    id: "pcat_019c0c0d9b377356b4f135c04d1af15a",
    name: "피부미용",
    handle: "pibumiyong",
  },
  {
    id: "pcat_019c0c0d9b377356b4f1522146205c90",
    name: "헤어",
    handle: "heeo",
  },
  {
    id: "pcat_019c0c0d9b377356b4efcdf0669629e1",
    name: "왁싱",
    handle: "waksing",
  },
  {
    id: "pcat_019c0c0d9b38734abfd34c0a584ffe35",
    name: "노몬드",
    handle: "nomondeu",
  },
] as const

export type FixedCategory = (typeof FIXED_CATEGORIES)[number]
