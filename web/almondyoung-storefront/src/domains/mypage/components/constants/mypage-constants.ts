import { MenuItem, MenuSection, QuickLink } from "../../types/mypage-types"

export const QUICK_LINKS: QuickLink[] = [
  { label: "주문목록", icon: "📦" },
  { label: "찜한상품", icon: "❤️" },
  { label: "자주산상품", icon: "🛍️" },
  { label: "맞춤정보", icon: "👀" },
]

export const MENU_ITEMS: MenuItem[] = [
  { label: "주문조회", icon: "📄", path: "/mypage/order/list" },
  {
    label: "기존 아몬드영 주문내역 확인",
    icon: "🧾",
    path: "/mypage/order/legacy",
  },
  { label: "취소 / 반품 / 교환목록", icon: "🔄", path: "/mypage/exchange" },
  { label: "리뷰 관리", icon: "⭐", path: "/mypage/reviews" },
  { label: "아몬드영 멤버십", icon: "💎", path: "/mypage/membership" },
  {
    label: "멤버십 내역 확인",
    icon: "📘",
    path: "https://almondyoung.com/myshop#",
  },
  { label: "결제수단", icon: "💳", path: "/mypage/payment" },
  { label: "적립금", icon: "💰", path: "/mypage/point" },
  { label: "회원정보 수정", icon: "👤", path: "/mypage/account/profile" },
  { label: "비밀번호 변경", icon: "🔒", path: "/mypage/account/password" },
  {
    label: "기존 아몬드영 계정 연결",
    icon: "🔗",
    path: "/mypage/account/cafe24",
  },
  // todo: 쿠폰 임시 비활성화
  // { label: "쿠폰", icon: "🏷️", path: "/mypage/coupons" },
  { label: "다운로드", icon: "📥", path: "/mypage/download" },
  // { label: "구독 관리", icon: "🔁", path: "/mypage/subscribe/manage" },
  {
    label: "사업자 정보",
    icon: "💼",
    path: "/mypage/business",
  },
  { label: "로그아웃", icon: "🚪", action: "logout" },
]

export const MENU_SECTIONS: MenuSection[] = [
  {
    title: "주문 및 배송",
    items: [
      { label: "주문 내역", icon: "📦", path: "/mypage/order/list" },
      {
        label: "기존 아몬드영 주문내역 확인",
        icon: "🧾",
        path: "/mypage/order/legacy",
      },
      { label: "취소/반품/교환", icon: "🔄", path: "/mypage/exchange" },
      { label: "찜한 상품", icon: "❤️", path: "/mypage/wish" },
    ],
  },
  {
    title: "계정 관리",
    items: [
      { label: "회원정보 수정", icon: "👤", path: "/mypage/account/profile" },
      { label: "비밀번호 변경", icon: "🔒", path: "/mypage/account/password" },
      { label: "기존 계정 연결", icon: "🔗", path: "/mypage/account/cafe24" },
      { label: "맞춤설정", icon: "👀", path: "/mypage/shop-setting" },
      { label: "사업자 정보", icon: "💼", path: "/mypage/business" },
      { label: "로그아웃", icon: "🚪", action: "logout" },
    ],
  },
  {
    title: "혜택 및 서비스",
    items: [
      { label: "아몬드영 멤버십", icon: "💎", path: "/mypage/membership" },
      {
        label: "멤버십 내역 확인",
        icon: "📘",
        path: "https://almondyoung.com/myshop#",
      },
      { label: "적립금", icon: "💰", path: "/mypage/point" },
      { label: "결제수단", icon: "💳", path: "/mypage/payment" },
      { label: "리뷰 관리", icon: "⭐", path: "/mypage/reviews" },
      { label: "다운로드", icon: "📥", path: "/mypage/download" },
    ],
  },
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
    id: "legacy-order",
    label: "기존 아몬드영 주문내역 확인",
    hasSubMenu: false,
    path: "/mypage/order/legacy",
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
    id: "shopSettings",
    label: "맞춤설정",
    hasSubMenu: false,
    path: "/mypage/shop-setting",
  },
  {
    id: "account",
    label: "계정 설정",
    hasSubMenu: true,
    subItems: [
      {
        id: "account-profile",
        label: "회원정보 수정",
        path: "/mypage/account/profile",
      },
      {
        id: "account-password",
        label: "비밀번호 변경",
        path: "/mypage/account/password",
      },
      {
        id: "account-cafe24",
        label: "기존 아몬드영 계정 연결",
        path: "/mypage/account/cafe24",
      },
    ],
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
    id: "legacy-membership",
    label: "멤버십 내역 확인",
    hasSubMenu: false,
    path: "https://almondyoung.com/myshop#",
  },
  {
    id: "payment",
    label: "결제수단 · 적립금",
    hasSubMenu: false,
    path: "/mypage/payment",
  },
  // {
  //   id: "coupon",
  //   label: "쿠폰",
  //   hasSubMenu: false,
  //   path: "/mypage/coupons",
  // },
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
