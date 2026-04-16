import { useState, useEffect } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { Header } from "./header"
import { getActiveMenuAndItem, type MenuItem } from "@/lib/menu"

export function MainLayout() {
  const location = useLocation()
  const [activeMenu, setActiveMenu] = useState("catalog")
  const [activeItem, setActiveItem] = useState<string | undefined>()

  useEffect(() => {
    const { menuId, itemId } = getActiveMenuAndItem(location.pathname)
    if (menuId) {
      setActiveMenu(menuId)
      setActiveItem(itemId ?? undefined)
    }
  }, [location.pathname])

  const handleMenuChange = (menuId: string) => {
    setActiveMenu(menuId)
    setActiveItem(undefined)
  }

  const handleItemClick = (item: MenuItem) => {
    setActiveItem(item.id)
  }

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        activeMenu={activeMenu}
        activeItem={activeItem}
        onItemClick={handleItemClick}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header activeMenu={activeMenu} onMenuChange={handleMenuChange} />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  )
}
