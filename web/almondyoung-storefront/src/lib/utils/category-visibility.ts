/*───────────────────────────
 * 멤버십 회원에게만 노출하는 카테고리.
 *
 * 판정 기준은 Medusa 카테고리 `metadata.isVisibleToMembersOnly`.
 * 관리자 카테고리 화면의 "멤버십 전용" 토글을 켜면 core → channel-adapter 를 거쳐 채워진다.
 *──────────────────────────*/

type CategoryVisibilityFields = {
  handle?: string | null
  metadata?: Record<string, unknown> | null
  parent_category?: CategoryVisibilityFields | null
}

export function isMembersOnlyCategory(
  category: CategoryVisibilityFields | null | undefined
): boolean {
  if (!category) return false

  const flag = category.metadata?.isVisibleToMembersOnly
  return flag === true || flag === "true"
}

/**
 * 조상 중 하나라도 회원전용이면 자손도 회원전용으로 본다.
 * 메뉴 트리는 부모를 지우면 자식도 함께 빠지지만, 자식 URL 로 바로 들어오는 경우
 * 조상을 따라 올라가 확인해야 막힌다.
 */
export function isMembersOnlyBranch(
  category: CategoryVisibilityFields | null | undefined
): boolean {
  let node = category
  while (node) {
    if (isMembersOnlyCategory(node)) return true
    node = node.parent_category
  }
  return false
}

type CategoryTreeLike<T> = {
  handle?: string | null
  is_active?: boolean | null
  metadata?: Record<string, unknown> | null
  category_children?: T[] | null
}

/** 회원전용 카테고리를 트리 전체(자식 포함)에서 제거한 새 배열을 돌려준다. */
export function filterMembersOnlyCategories<T extends CategoryTreeLike<T>>(
  categories: T[]
): T[] {
  return categories
    .filter((category) => !isMembersOnlyCategory(category))
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
