export interface MenuItem {
  id: string
  title: string
  icon?: string
  children?: MenuItem[]
  path?: string
  isComingSoon?: boolean
}

export interface MainMenu {
  id: string
  title: string
  icon: string
  children: MenuItem[]
  defaultPath?: string
}

export const mainMenus: MainMenu[] = [
  {
    id: "catalog",
    title: "판매상품",
    icon: "Package",
    defaultPath: "/catalog/products",
    children: [
      {
        id: "catalog-products-drafts",
        title: "작성중 상품",
        path: "/catalog/products/drafts",
      },
      {
        id: "catalog-products",
        title: "상품 관리",
        path: "/catalog/products",
      },
      {
        id: "catalog-categories",
        title: "카테고리 관리",
        path: "/catalog/categories",
      },
      {
        id: "catalog-tags",
        title: "태그 관리",
        path: "/catalog/tags",
      },
    ],
  },
  {
    id: "inventory",
    title: "재고",
    icon: "Boxes",
    defaultPath: "/inventory/skus",
    children: [
      {
        id: "inventory-skus",
        title: "재고상품 관리",
        path: "/inventory/skus",
      },
    ],
  },
]

export function getMenuById(id: string): MainMenu | undefined {
  return mainMenus.find((m) => m.id === id)
}

export function getActiveMenuAndItem(pathname: string): {
  menuId: string | null
  itemId: string | null
} {
  for (const menu of mainMenus) {
    const item = findItemByPath(menu.children, pathname)
    if (item) return { menuId: menu.id, itemId: item.id }
  }
  return { menuId: mainMenus[0]?.id ?? null, itemId: null }
}

function findItemByPath(
  items: MenuItem[],
  pathname: string,
): MenuItem | null {
  for (const item of items) {
    if (item.path && pathname.startsWith(item.path)) return item
    if (item.children) {
      const found = findItemByPath(item.children, pathname)
      if (found) return found
    }
  }
  return null
}
