// home-sections-config.ts
// 홈 페이지 섹션 설정 관리
// TODO: 추후 API 엔드포인트에서 섹션 설정을 받아오도록 변경 예정

import type { ProductListParams } from "@lib/services/pim/products/getProductListService"

export interface HomeSectionConfig {
  id: string
  title: string
  description?: string
  queryParams: ProductListParams
  // 추후 API에서 받아올 필드들
  // sectionType?: string
  // displayOrder?: number
  // isActive?: boolean
}

// TODO: 추후 API 엔드포인트에서 섹션 설정을 받아오도록 변경
// 현재는 mock데이터로 하드코딩
export const homeSectionsConfig: Record<string, HomeSectionConfig> = {
  // 비로그인 사용자용 섹션
  newProducts: {
    id: "newProducts",
    title: "신상품",
    description: "신상품을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      // 등록일자 최근순 정렬 (PIM API에서 createdAt 기준 정렬)
      // TODO: PIM API 정렬 파라미터 확인 후 수정 필요
      sort: "createdAt:desc",
    },
  },
  welcomeDeal: {
    id: "welcomeDeal",
    title: "웰컴딜 전체 제품 100원",
    description: "웰컴딜 전체 제품을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  digitalTemplate: {
    id: "digitalTemplate",
    title: "간편편집, 뷰티샵 디지털 템플릿",
    description: "캔바로 쉽게 편집할 수 있는 전문가용 템플릿",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  hotRising: {
    id: "hotRising",
    title: "인기 급상승 제품",
    description: "이번 주 가장 인기 있는 제품들을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  frequentRebuy: {
    id: "frequentRebuy",
    title: "재구매 많은 제품",
    description: "한 번 사면 반드시 다시 구매하는 제품들을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },

  // 로그인 사용자용 섹션
  recommended: {
    id: "recommended",
    title: "추천제품",
    description: "#시즌제품 #스마트케어 #머신 신제품",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  frequentIngredients: {
    id: "frequentIngredients",
    title: "자주 구매하는 재료 다시담기",
    description: "자주 구매하는 재료를 다시담기",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  cartWaiting: {
    id: "cartWaiting",
    title: "장바구니에서 기다리는 상품",
    description: "장바구니에서 기다리는 상품을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  expertRecommended: {
    id: "expertRecommended",
    title: "전문가를 위한 추천제품",
    description: "전문가를 위한 추천제품을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
  membershipProducts: {
    id: "membershipProducts",
    title: "웰컴드 전체 제품 100원",
    description: "웰컴드 전체 제품을 만나보세요",
    queryParams: {
      page: 1,
      limit: 10,
      sort: "createdAt:desc",
    },
  },
}

// 비로그인 사용자용 섹션 ID 목록
export const logoutSectionIds = [
  "newProducts",
  "welcomeDeal",
  "digitalTemplate",
  "hotRising",
  "frequentRebuy",
] as const

// 로그인 사용자용 섹션 ID 목록
export const loggedInSectionIds = [
  "recommended",
  "frequentIngredients",
  "cartWaiting",
  "expertRecommended",
  "membershipProducts",
] as const

