/*───────────────────────────
 * 멤버십 회원에게만 노출하는 카테고리.
 *
 * 소속 상품이 전부 회원전용(`metadata.isVisibleToMembersOnly`)이라 비회원에게는
 * 빈 페이지가 되는 카테고리를, 네비게이션 목록과 카테고리 페이지 양쪽에서 감춘다.
 * 상품/DB 는 건드리지 않는다 — 노출 레이어에서만 거른다.
 *──────────────────────────*/

/** 퍼마블렌드(cafe24-cat-339): live 기준 published 94건 전부 회원전용 */
export const MEMBERS_ONLY_CATEGORY_HANDLES = new Set(["cafe24-cat-339"])

export function isMembersOnlyCategoryHandle(
  handle?: string | null
): boolean {
  return !!handle && MEMBERS_ONLY_CATEGORY_HANDLES.has(handle)
}

type CategoryTreeLike<T> = {
  handle?: string | null
  is_active?: boolean | null
  category_children?: T[] | null
}

/**
 * 비활성(is_active=false) 카테고리 제거.
 *
 * Medusa store API 는 **최상위 결과에만** is_active 필터를 건다. `include_descendants_tree`
 * 없이 relation 으로 `category_children` 을 펼치면 비활성 자식이 그대로 딸려온다
 * (관리자에서 삭제한 카테고리가 메뉴에 남아 보이던 원인). 조회 옵션에만 기대지 않도록
 * 응답을 한 번 더 거른다. is_active 가 응답에 없으면(필드 미요청) 건드리지 않는다.
 */
export function filterInactiveCategories<T extends CategoryTreeLike<T>>(
  categories: T[]
): T[] {
  return categories
    .filter((category) => category.is_active !== false)
    .map((category) =>
      category.category_children?.length
        ? {
            ...category,
            category_children: filterInactiveCategories(
              category.category_children
            ),
          }
        : category
    )
}

/** 회원전용 카테고리를 트리 전체(자식 포함)에서 제거한 새 배열을 돌려준다. */
export function filterMembersOnlyCategories<T extends CategoryTreeLike<T>>(
  categories: T[]
): T[] {
  return categories
    .filter((category) => !isMembersOnlyCategoryHandle(category.handle))
    .map((category) =>
      category.category_children?.length
        ? {
            ...category,
            category_children: filterMembersOnlyCategories(
              category.category_children
            ),
          }
        : category
    )
}
