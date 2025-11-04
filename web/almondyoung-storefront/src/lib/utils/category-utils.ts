// src/lib/utils/category-utils.ts
import type { PimCategory } from "@lib/types/dto/pim"

/**
 * 카테고리 트리에서 ID로 카테고리 찾기 (재귀 검색)
 */
export function findCategoryById(
  categories: PimCategory[],
  id: string
): PimCategory | null {
  for (const category of categories) {
    if (category.id === id) {
      return category
    }
    if (category.children?.length) {
      const found = findCategoryById(category.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * 카테고리 트리에서 slug로 카테고리 찾기 (재귀 검색)
 */
export function findCategoryBySlug(
  categories: PimCategory[],
  slug: string
): PimCategory | null {
  for (const category of categories) {
    if (category.slug === slug) {
      return category
    }
    if (category.children?.length) {
      const found = findCategoryBySlug(category.children, slug)
      if (found) return found
    }
  }
  return null
}

/**
 * 카테고리 트리에서 slug, name 또는 id로 카테고리 찾기
 */
export function findCategoryByAny(
  categories: PimCategory[],
  identifier: string
): PimCategory | null {
  for (const category of categories) {
    if (
      category.id === identifier ||
      category.slug === identifier ||
      category.name?.toLowerCase() === identifier.toLowerCase()
    ) {
      return category
    }
    if (category.children?.length) {
      const found = findCategoryByAny(category.children, identifier)
      if (found) return found
    }
  }
  return null
}

/**
 * 특정 카테고리의 부모 카테고리 찾기
 */
export function findParentCategory(
  categories: PimCategory[],
  categoryId: string
): PimCategory | null {
  for (const category of categories) {
    // 직접 자식인지 확인
    if (category.children?.some((child) => child.id === categoryId)) {
      return category
    }
    // 자손인지 재귀 확인
    if (category.children?.length) {
      const found = findParentCategory(category.children, categoryId)
      if (found) return found
    }
  }
  return null
}

/**
 * 카테고리의 조상 경로 찾기 (루트부터 해당 카테고리까지)
 */
export function buildCategoryPath(
  categories: PimCategory[],
  categoryId: string
): PimCategory[] {
  const stack: PimCategory[] = []
  let found: PimCategory[] | null = null

  const dfs = (node: PimCategory) => {
    if (found) return
    stack.push(node)
    if (node.id === categoryId) {
      found = [...stack]
      stack.pop()
      return
    }
    for (const child of node.children ?? []) {
      dfs(child)
    }
    stack.pop()
  }

  for (const root of categories) {
    dfs(root)
    if (found) break
  }
  return found ?? []
}

/**
 * 카테고리 트리를 평탄화 (모든 카테고리를 1차원 배열로)
 * 성능이 중요한 경우 한 번만 실행하고 결과를 캐싱하세요
 */
export function flattenCategories(categories: PimCategory[]): PimCategory[] {
  const result: PimCategory[] = []

  const flatten = (cats: PimCategory[]) => {
    for (const cat of cats) {
      result.push(cat)
      if (cat.children?.length) {
        flatten(cat.children)
      }
    }
  }

  flatten(categories)
  return result
}
