export interface SubMenuItem {
  id: string
  label: string
  path: string // countryCode 제외된 경로 (예: "/mypage/reviews")
}

export interface MenuItem {
  id: string
  label: string
  path?: string // 단일 메뉴인 경우의 경로
  hasSubMenu: boolean
  subItems?: SubMenuItem[]
}

export interface MypageSidebarProps {
  countryCode: string
  menuItems?: MenuItem[] // 선택적으로 외부에서 주입 가능
  className?: string
}
