/**
 * PIM API 타입 정의
 * 서버의 DTO 구조를 정확히 반영합니다.
 * 스키마에 있지만 DTO에 명시되지 않은 필드(imageUrl)는 optional로 추가했습니다.
 */

// 카테고리 트리 노드 (트리 조회용)
// 서버의 CategoryTreeNodeDto 구조
export interface CategoryTreeNode {
  id: string
  name: string
  description: string | null
  slug: string
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  productCount?: number
  children?: CategoryTreeNode[]
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
}

// 카테고리 트리 응답
// 서버의 CategoryTreeResponseDto 구조
export interface CategoryTreeResponse {
  categories: CategoryTreeNode[]
  totalCount: number
  maxDepth: number
}

// 카테고리 기본 응답 (일반 조회용)
// 서버의 CategoryResponseDto 구조
export interface CategoryResponse {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: Date | string
  updatedAt: Date | string
  childCount?: number
  productCount?: number
  thumbnail?: string | null
  basePrice?: string | null
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
}

// 카테고리 상세 응답
// 서버의 CategoryDetailResponseDto 구조
export interface CategoryDetailResponse {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: Date | string
  updatedAt: Date | string
  parent?: CategoryResponse
  children: CategoryResponse[]
  productCount: number
  totalProductCount: number
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
}

// 카테고리 경로 정보
// 서버의 CategoryPathInfoDto 구조
export interface CategoryPathInfo {
  id: string
  name: string
  slug: string
  level: number
}

// 카테고리 경로 응답
// 서버의 CategoryPathResponseDto 구조
export interface CategoryPathResponse {
  categoryId: string
  path: CategoryPathInfo[]
  fullPath: string
}

// 프론트엔드에서 사용하는 통합 카테고리 타입
// 트리 노드와 일반 응답을 모두 포함할 수 있도록 확장
export type PimCategory = CategoryTreeNode | CategoryResponse
