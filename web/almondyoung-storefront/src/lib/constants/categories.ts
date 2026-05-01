// 메인 카테고리 고정 목록 (홈 베스트, 헤더 네비게이션 등에서 사용)
// id: Medusa product_category id
// pimCategoryId: PIM category id (analytics 등 PIM 기반 조회에 사용)
export const FIXED_CATEGORIES = [
  {
    id: "pcat_019c0c0d9b3677dc85395e40e8411453",
    pimCategoryId: "019b3bee-d3a9-774d-aec2-3737df8cbd2c",
    name: "속눈썹펌",
    handle: "soknunsseoppeom",
  },
  {
    id: "pcat_019c0c0d9b377356b4ef999a294d9dd2",
    pimCategoryId: "019b3bee-d3cc-70af-a4ca-8101cbf44f27",
    name: "속눈썹연장",
    handle: "soknunsseopyeonjang",
  },
  {
    id: "pcat_019c0c0d9b38734abfd42633f3bed370",
    pimCategoryId: "019b3bee-d621-75de-a3c3-66604e55bcec",
    name: "반영구",
    handle: "banyeonggu",
  },
  {
    id: "pcat_019c0c0d9b38734abfd431dad85663f6",
    pimCategoryId: "019b3bee-d626-71ad-a486-9b6d6e629410",
    name: "네일아트",
    handle: "neilateu",
  },
  {
    id: "pcat_019c0c0d9b377356b4efdfcf2a3fd02d",
    pimCategoryId: "019b3bee-d3f5-704b-8165-4b6ab83497b7",
    name: "타투",
    handle: "tatu",
  },
  {
    id: "pcat_019c0c0d9b377356b4f135c04d1af15a",
    pimCategoryId: "019b3bee-d4b9-725c-84e1-8d9a345dbede",
    name: "피부미용",
    handle: "pibumiyong",
  },
  {
    id: "pcat_019c0c0d9b377356b4f1522146205c90",
    pimCategoryId: "019b3bee-d4c9-723e-bb1b-85421294a2d5",
    name: "헤어",
    handle: "heeo",
  },
  {
    id: "pcat_019c0c0d9b377356b4efcdf0669629e1",
    pimCategoryId: "019b3bee-d3ed-77ee-9fa9-1004bac0ed1c",
    name: "왁싱",
    handle: "waksing",
  },
  {
    id: "pcat_019c0c0d9b38734abfd34c0a584ffe35",
    pimCategoryId: "019b3bee-d5a6-74f9-9e01-18fb06729abb",
    name: "노몬드",
    handle: "nomondeu",
  },
] as const

export type FixedCategory = (typeof FIXED_CATEGORIES)[number]
