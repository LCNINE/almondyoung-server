import { PimCategory } from '../types/dto/pim'

export interface CategoryData {
  id: string
  name: string
  description?: string
  imageUrl?: string
  children?: CategoryData[]
  parent?: CategoryData
}

/**
 * PIM 카테고리를 내부 CategoryData 형식으로 변환
 */
export function convertPimToCategory(pimCategory: PimCategory): CategoryData {
  return {
    id: pimCategory.id,
    name: pimCategory.name,
    description: pimCategory.description || undefined,
    imageUrl: pimCategory.imageUrl || undefined,
    children: pimCategory.children?.map(convertPimToCategory),
    parent: undefined // 부모는 별도로 설정해야 함
  }
}

/**
 * Mock 카테고리 데이터 (API 실패 시 폴백용)
 */
const MOCK_CATEGORIES: CategoryData[] = [
  {
    id: '1',
    name: '아이래쉬',
    description: '아이래쉬 관련 제품',
    children: [
      {
        id: '1-1',
        name: '아이래쉬 기본',
        description: '아이래쉬 기본 제품들'
      },
      {
        id: '1-2',
        name: '아이래쉬 고급',
        description: '아이래쉬 고급 제품들'
      }
    ]
  },
  {
    id: '2',
    name: '아이브로우',
    description: '아이브로우 관련 제품',
    children: [
      {
        id: '2-1',
        name: '아이브로우 기본',
        description: '아이브로우 기본 제품들'
      },
      {
        id: '2-2',
        name: '아이브로우 고급',
        description: '아이브로우 고급 제품들'
      }
    ]
  },
  {
    id: '3',
    name: '립',
    description: '립 관련 제품',
    children: [
      {
        id: '3-1',
        name: '립 기본',
        description: '립 기본 제품들'
      },
      {
        id: '3-2',
        name: '립 고급',
        description: '립 고급 제품들'
      }
    ]
  }
]

/**
 * ID로 카테고리 찾기 (재귀적으로 검색)
 */
export function getCategoryById(id: string): CategoryData | null {
  const findCategory = (categories: CategoryData[], targetId: string): CategoryData | null => {
    for (const category of categories) {
      if (category.id === targetId) {
        return category
      }
      if (category.children) {
        const found = findCategory(category.children, targetId)
        if (found) return found
      }
    }
    return null
  }

  return findCategory(MOCK_CATEGORIES, id)
}
