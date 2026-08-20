"use server"

import { getIsMembershipCustomer } from "@/lib/data/membership"
import { sdk } from "@/lib/config/medusa"
import { CATEGORY_TREE_TAG } from "@lib/data/cache-tags"
import {
  filterInactiveCategories,
  filterMembersOnlyCategories,
  isMembersOnlyBranch,
} from "@/lib/utils/category-visibility"
import { HttpTypes } from "@medusajs/types"

const sortCategoriesByRank = (
  categories: HttpTypes.StoreProductCategory[]
): HttpTypes.StoreProductCategory[] => {
  return categories
    .map((category) => ({
      ...category,
      category_children: category.category_children
        ? sortCategoriesByRank(category.category_children)
        : [],
    }))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

export const listCategories = async (query?: Record<string, any>) => {
  const limit = query?.limit || 100

  return sdk.client
    .fetch<{ product_categories: HttpTypes.StoreProductCategory[] }>(
      "/store/product-categories",
      {
        query: {
          // `+is_active` — 스칼라를 그냥 나열하면 기본 필드(name/handle/rank)가 통째로
          // 빠진다. `+` 접두사여야 기본 필드를 유지한 채 추가된다.
          fields:
            "+is_active, *category_children, *parent_category, *parent_category.parent_category",
          // 메가메뉴 3단(대분류→중분류→소분류)용으로 전체 하위 트리 로드.
          // (중첩 fields `*category_children.category_children` 는 손자를 안 채움 — 이 옵션이 필요)
          include_descendants_tree: true,
          limit,
          ...query,
        },
        next: { tags: [CATEGORY_TREE_TAG], revalidate: 3600 },
      }
    )
    .then(async ({ product_categories }) => {
      // 비활성 카테고리(관리자에서 삭제/숨김)는 응답 단계에서 한 번 더 거른다.
      const sorted = filterInactiveCategories(
        sortCategoriesByRank(product_categories)
      )
      // 회원전용 카테고리는 멤버십 미가입자에게 목록에서 아예 감춘다.
      return (await getIsMembershipCustomer())
        ? sorted
        : filterMembersOnlyCategories(sorted)
    })
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  // segments의 마지막이 실제 카테고리 handle (예: ["clothing", "shirts"] → "shirts")
  const handle = categoryHandle[categoryHandle.length - 1]

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          // fields: "*category_children, *products",
          fields: "*category_children",
          include_descendants_tree: true,
          handle,
        },
        next: { tags: [CATEGORY_TREE_TAG], revalidate: 3600 },
      }
    )
    .then(async ({ product_categories }) => {
      const category = product_categories[0]
      if (!category) return undefined

      const isMember = await getIsMembershipCustomer()
      // 회원전용 카테고리는 URL 직접 접근도 막는다(호출부에서 notFound 처리).
      if (isMembersOnlyBranch(category) && !isMember) {
        return undefined
      }

      // 자식 트리도 목록과 같은 기준으로 거른다 — 안 거르면 하위 카테고리 내비와
      // 상품 목록(자손 id 합산)에 비활성·회원전용 자식이 그대로 새어 나온다.
      if (category.category_children?.length) {
        const children = filterInactiveCategories(category.category_children)
        return {
          ...category,
          category_children: isMember
            ? children
            : filterMembersOnlyCategories(children),
        }
      }
      return category
    })
}
