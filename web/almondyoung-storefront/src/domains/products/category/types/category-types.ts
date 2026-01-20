export const CATEGORY_DATA = {
  hair: {
    title: "헤어",
    description: "뷰티샵을 위한 전문 헤어 제품",
  },
  semi: {
    title: "반영구",
    description: "안전하고 검증된 반영구 화장 제품",
  },
  nail: {
    title: "네일",
    description: "프로페셔널 네일 케어 제품",
  },
  lash: {
    title: "속눈썹",
    description: "속눈썹 연장 및 케어 전문 제품",
  },
  waxing: {
    title: "왁싱",
    description: "피부에 안전한 왁싱 제품",
  },
  skin: {
    title: "피부미용",
    description: "전문가용 스킨케어 제품",
  },
  tattoo: {
    title: "타투",
    description: "타투 아티스트를 위한 전문 용품",
  },
  makeup: {
    title: "메이크업",
    description: "뷰티샵을 위한 전문 메이크업 제품",
  },
} as const

export type CategorySlug = keyof typeof CATEGORY_DATA

export interface CategoryInfo {
  title: string
  description: string
}
