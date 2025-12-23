import { MenuItem, QuickLink } from "../../types/mypage-types"

export const QUICK_LINKS: QuickLink[] = [
  { label: "주문목록", icon: "📦" },
  { label: "찜한상품", icon: "❤️" },
  { label: "자주산상품", icon: "🛍️" },
  { label: "맞춤정보", icon: "👀" },
]

export const MENU_ITEMS: MenuItem[] = [
  { label: "주문조회", icon: "📄", path: "/mypage/order/list" },
  { label: "취소 / 반품 / 교환목록", icon: "🔄", path: "/mypage/exchange" },
  { label: "리뷰 관리", icon: "⭐", path: "/mypage/reviews" },
  { label: "아몬드영 멤버십", icon: "💎", path: "/mypage/membership" },
  { label: "결제수단", icon: "💳", path: "/mypage/payment" },
  { label: "적립금", icon: "💰", path: "/mypage/point" },
  { label: "쿠폰", icon: "🏷️", path: "/mypage/coupons" },
  { label: "다운로드", icon: "📥", path: "/mypage/download" },
  // { label: "구독 관리", icon: "🔁", path: "/mypage/subscribe/manage" },
  {    
    label: "사업자 정보",
    icon: "💼",
    path: "/mypage/business",
  },
  { label: "로그아웃", icon: "🚪", path: "/mypage/logout" },
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
    path: "/mypage/payment",
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
  // {
  //   id: "subscription",
  //   label: "구독 관리",
  //   hasSubMenu: false,
  //   path: "/mypage/subscribe/manage",
  // },
  {
    id: "business",
    label: "사업자 정보",
    hasSubMenu: false,
    path: "/mypage/business",
  },
]

export const BREAKPOINTS = {
  MOBILE: "md",
  DESKTOP: "md",
} as const
