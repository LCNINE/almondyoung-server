import { MenuItem, MenuSection, QuickLink } from "../../types/mypage-types"

// 각 label 은 i18n key (next-intl). 사용처에서 `t(item.label)` 형태로 변환한다.

export const QUICK_LINKS: QuickLink[] = [
  { label: "mypage.quickLink.orderList", icon: "📦" },
  { label: "mypage.quickLink.wish", icon: "❤️" },
  { label: "mypage.quickLink.rebuy", icon: "🛍️" },
  { label: "mypage.quickLink.customInfo", icon: "👀" },
]

export const MENU_ITEMS: MenuItem[] = [
  { label: "mypage.menu.orderInquiry", icon: "📄", path: "/mypage/order/list" },
  {
    label: "mypage.menu.orderLegacy",
    icon: "🧾",
    path: "/mypage/order/legacy",
  },
  { label: "mypage.menu.exchangeLong2", icon: "🔄", path: "/mypage/exchange" },
  { label: "mypage.menu.review", icon: "⭐", path: "/mypage/reviews" },
  { label: "mypage.menu.membership", icon: "💎", path: "/mypage/membership" },
  { label: "mypage.menu.payment", icon: "💳", path: "/mypage/membership/payment-method" },
  { label: "mypage.menu.point", icon: "💰", path: "/mypage/point" },
  { label: "mypage.menu.profile", icon: "👤", path: "/mypage/account/profile" },
  { label: "mypage.menu.password", icon: "🔒", path: "/mypage/account/password" },
  {
    label: "mypage.menu.cafe24",
    icon: "🔗",
    path: "/mypage/account/cafe24",
  },
  { label: "mypage.menu.coupon", icon: "🏷️", path: "/mypage/coupons" },
  { label: "mypage.menu.logout", icon: "🚪", action: "logout" },
]

export const MENU_SECTIONS: MenuSection[] = [
  {
    title: "mypage.section.orderShipping",
    items: [
      { label: "mypage.menu.orderList", icon: "📦", path: "/mypage/order/list" },
      {
        label: "mypage.menu.orderLegacy",
        icon: "🧾",
        path: "/mypage/order/legacy",
      },
      { label: "mypage.menu.exchange", icon: "🔄", path: "/mypage/exchange" },
    ],
  },
  {
    title: "mypage.section.accountManagement",
    items: [
      { label: "mypage.menu.profile", icon: "👤", path: "/mypage/account/profile" },
      { label: "mypage.menu.password", icon: "🔒", path: "/mypage/account/password" },
      { label: "mypage.menu.orderLegacyShort", icon: "🔗", path: "/mypage/account/cafe24" },
      { label: "mypage.menu.shopSetting", icon: "👀", path: "/mypage/shop-setting" },
      {
        label: "mypage.menu.withdraw",
        icon: "🚫",
        path: "/mypage/account/withdraw",
      },
      { label: "mypage.menu.logout", icon: "🚪", action: "logout" },
    ],
  },
  {
    title: "mypage.section.benefits",
    items: [
      { label: "mypage.menu.membership", icon: "💎", path: "/mypage/membership" },
      { label: "mypage.menu.point", icon: "💰", path: "/mypage/point" },
      { label: "mypage.menu.coupon", icon: "🏷️", path: "/mypage/coupons" },
      { label: "mypage.menu.payment", icon: "💳", path: "/mypage/membership/payment-method" },
      { label: "mypage.menu.review", icon: "⭐", path: "/mypage/reviews" },
      { label: "mypage.menu.inquiries", icon: "❓", path: "/mypage/inquiries" },
    ],
  },
]

export const SIDEBAR_MENU_ITEMS = [
  {
    id: "home",
    label: "mypage.menu.home",
    hasSubMenu: false,
    path: "/mypage",
  },
  {
    id: "order",
    label: "mypage.menu.order",
    hasSubMenu: false,
    path: "/mypage/order/list",
  },
  {
    id: "legacy-order",
    label: "mypage.menu.orderLegacy",
    hasSubMenu: false,
    path: "/mypage/order/legacy",
  },
  {
    id: "wishlist",
    label: "mypage.menu.wish",
    hasSubMenu: false,
    path: "/mypage/wish",
  },
  {
    id: "frequent",
    label: "mypage.menu.rebuy",
    hasSubMenu: false,
    path: "/mypage/rebuy",
  },
  {
    id: "recent",
    label: "mypage.menu.recent",
    hasSubMenu: false,
    path: "/mypage/recent",
  },
  {
    id: "shopSettings",
    label: "mypage.menu.shopSetting",
    hasSubMenu: false,
    path: "/mypage/shop-setting",
  },
  {
    id: "account",
    label: "mypage.menu.account",
    hasSubMenu: true,
    subItems: [
      {
        id: "account-profile",
        label: "mypage.menu.profile",
        path: "/mypage/account/profile",
      },
      {
        id: "account-password",
        label: "mypage.menu.password",
        path: "/mypage/account/password",
      },
      {
        id: "account-cafe24",
        label: "mypage.menu.cafe24",
        path: "/mypage/account/cafe24",
      },
      {
        id: "account-withdraw",
        label: "mypage.menu.withdraw",
        path: "/mypage/account/withdraw",
      },
    ],
  },
  {
    id: "return",
    label: "mypage.menu.exchangeLong",
    hasSubMenu: false,
    path: "/mypage/exchange",
  },
  {
    id: "review",
    label: "mypage.menu.reviewShort",
    hasSubMenu: false,
    path: "/mypage/reviews",
  },
  {
    id: "inquiries",
    label: "mypage.menu.inquiries",
    hasSubMenu: false,
    path: "/mypage/inquiries",
  },
  {
    id: "membership",
    label: "mypage.menu.membership",
    hasSubMenu: false,
    path: "/mypage/membership",
  },
  {
    id: "point",
    label: "mypage.menu.point",
    hasSubMenu: false,
    path: "/mypage/point",
  },
  {
    id: "payment",
    label: "mypage.menu.payment",
    hasSubMenu: false,
    path: "/mypage/membership/payment-method",
  },
  {
    id: "coupon",
    label: "mypage.menu.coupon",
    hasSubMenu: false,
    path: "/mypage/coupons",
  },
]

export const BREAKPOINTS = {
  MOBILE: "md",
  DESKTOP: "md",
} as const
