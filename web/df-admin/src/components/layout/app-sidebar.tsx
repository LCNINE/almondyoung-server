import { useState, useEffect } from "react"
import { getMenuById, type MenuItem } from "@/lib/menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { SidebarMenuItemRecursive } from "./sidebar-menu-item"

interface AppSidebarProps {
  activeMenu: string
  activeItem?: string
  onItemClick: (item: MenuItem) => void
}

function findParentPath(
  items: MenuItem[],
  targetId: string,
  path: string[] = [],
): string[] | null {
  for (const item of items) {
    if (item.id === targetId) return path
    if (item.children) {
      const found = findParentPath(item.children, targetId, [...path, item.id])
      if (found) return found
    }
  }
  return null
}

export function AppSidebar({
  activeMenu,
  activeItem,
  onItemClick,
}: AppSidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const currentMenu = getMenuById(activeMenu)

  useEffect(() => {
    if (activeItem && currentMenu) {
      const parentPath = findParentPath(currentMenu.children, activeItem)
      if (parentPath && parentPath.length > 0) {
        setExpandedItems((prev) => {
          const next = new Set([...prev, ...parentPath])
          return Array.from(next)
        })
      }
    }
  }, [activeItem, currentMenu])

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    )
  }

  if (!currentMenu) {
    return (
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="p-4">
          <div className="text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
            메뉴를 선택해주세요
          </div>
        </SidebarHeader>
        <SidebarRail />
      </Sidebar>
    )
  }

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:hidden">
            {currentMenu.title}
          </h2>
          <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {currentMenu.children.map((item) => (
              <SidebarMenuItemRecursive
                key={item.id}
                item={item}
                activeItem={activeItem}
                expandedItems={expandedItems}
                onToggleExpanded={toggleExpanded}
                onItemClick={onItemClick}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
