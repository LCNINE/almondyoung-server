import type { ShopListingStatus } from "../../lib/types/dto/shop-listing"

export type MyListingAction = "edit" | "close" | "reopen" | "delete"

// 서버 전이표(spec §5)의 회원 몫. hidden 은 수정하면 409 라 삭제만 연다.
const ACTIONS: Record<ShopListingStatus, readonly MyListingAction[]> = {
  published: ["edit", "close", "delete"],
  closed: ["edit", "reopen", "delete"],
  pending: ["edit", "delete"],
  rejected: ["edit", "delete"],
  hidden: ["delete"],
}

export function myListingActions(
  status: ShopListingStatus
): readonly MyListingAction[] {
  return ACTIONS[status]
}

/** 공개 중인 글을 고치면 pending 으로 내려가 공개 목록에서 빠진다 — 제출 전에 알린다 */
export function editRequiresReReview(status: ShopListingStatus): boolean {
  return status === "published" || status === "closed"
}
