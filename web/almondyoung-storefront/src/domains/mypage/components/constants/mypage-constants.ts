import { MenuItem, QuickLink } from "../../types/mypage-types"

export const QUICK_LINKS: QuickLink[] = [
  { label: "주문목록", icon: "📦" },
  { label: "찜한상품", icon: "❤️" },
  { label: "자주산상품", icon: "🛍️" },
  { label: "맞춤정보", icon: "👀" },
]

export const MENU_ITEMS: MenuItem[] = [
  { label: "주문조회", icon: "📄" },
  { label: "취소 / 반품 / 교환목록", icon: "🔄" },
  { label: "리뷰 관리", icon: "⭐" },
  { label: "아몬드영 멤버십", icon: "💎" },
  { label: "결제수단", icon: "💳" },
  { label: "적립금", icon: "💰" },
  { label: "쿠폰", icon: "🏷️" },
  { label: "다운로드", icon: "📥" },
  { label: "구독 관리", icon: "🔁" },
  { label: "로그아웃", icon: "🚪" },
]

export const SIDEBAR_MENU_ITEMS = [
  {
    id: "home",
    label: "마이페이지 홈",
    hasSubMenu: false,
    path: "/mypage",
  },
  {
    id: "order",
    label: "주문/배송 내역",
    hasSubMenu: false,
    path: "/mypage/order/list",
  },
  {
    id: "wishlist",
    label: "찜한 상품",
    hasSubMenu: false,
    path: "/mypage/wish",
  },
  {
    id: "frequent",
    label: "자주 산 상품",
    hasSubMenu: false,
    path: "/mypage/rebuy",
  },
  {
    id: "recent",
    label: "최근 본 상품",
    hasSubMenu: false,
    path: "/mypage/recent",
  },
  {
    id: "settings",
    label: "맞춤설정",
    hasSubMenu: false,
    path: "/mypage/setting",
  },
  {
    id: "return",
    label: "취소/반품 / 교환 목록",
    hasSubMenu: false,
    path: "/mypage/exchange",
  },
  {
    id: "review",
    label: "리뷰관리",
    hasSubMenu: false,
    path: "/mypage/reviews",
  },
  {
    id: "membership",
    label: "아몬드영 멤버십",
    hasSubMenu: false,
    path: "/mypage/membership",
  },
  {
    id: "payment",
    label: "결제수단 · 적립금",
    hasSubMenu: false,
    path: "/mypage/payment-methods",
  },
  {
    id: "coupon",
    label: "쿠폰",
    hasSubMenu: false,
    path: "/mypage/coupons",
  },
  {
    id: "download",
    label: "다운로드",
    hasSubMenu: false,
    path: "/mypage/download",
  },
  {
    id: "subscription",
    label: "구독 관리",
    hasSubMenu: false,
    path: "/mypage/subscribe/manage",
  },
]

export const BREAKPOINTS = {
  MOBILE: "md",
  DESKTOP: "md",
} as const
