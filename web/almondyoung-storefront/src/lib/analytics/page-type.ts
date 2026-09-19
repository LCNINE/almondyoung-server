const LIST_SEGMENTS = new Set(["category", "best", "new", "time-sale", "search"])
const BOARD_SEGMENTS = new Set(["cs", "shop-trade", "events"])

/**
 * 경로 → 화면 종류 GA4 이벤트. 어드민 실시간 접속자가 이 이벤트 이름으로 화면을 나눈다.
 * 상품상세는 화면이 매번 보내는 view_item 을 쓴다. 주문작성·결제완료는 begin_checkout·purchase 가
 * 세션당 한 번만 나가 재방문이 안 잡히므로 따로 보낸다.
 */
export function pageTypeEvent(pathname: string): string | null {
  const [, segment, sub] = pathname.split("/").filter(Boolean)
  if (!segment) return "view_home"
  if (segment === "checkout") {
    if (!sub) return "view_checkout"
    return sub === "success" ? "view_order_complete" : null
  }
  if (LIST_SEGMENTS.has(segment)) return "view_item_list"
  if (segment === "cart") return "view_cart"
  if (BOARD_SEGMENTS.has(segment)) return "view_board"
  return null
}
