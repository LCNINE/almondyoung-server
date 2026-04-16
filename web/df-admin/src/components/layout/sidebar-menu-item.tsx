import { ChevronRight } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import type { MenuItem } from "@/lib/menu"
import { cn } from "@/lib/utils"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"

interface SidebarMenuItemRecursiveProps {
  item: MenuItem
  activeItem?: string
  expandedItems: string[]
  onToggleExpanded: (id: string) => void
  onItemClick: (item: MenuItem) => void
  depth?: number
}

export function SidebarMenuItemRecursive({
  item,
  activeItem,
  expandedItems,
  onToggleExpanded,
  onItemClick,
  depth = 0,
}: SidebarMenuItemRecursiveProps) {
  const location = useLocation()
  const isActive = activeItem === item.id || (item.path && location.pathname.startsWith(item.path))
  const hasChildren = item.children && item.children.length > 0
  const isExpanded = expandedItems.includes(item.id)

  if (hasChildren) {
    return (
      <Collapsible open={isExpanded} onOpenChange={() => onToggleExpanded(item.id)}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton className={cn(isActive && "font-medium")}>
              <span>{item.title}</span>
              <ChevronRight
                className={cn(
                  "ml-auto h-4 w-4 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.children!.map((child) =>
                child.children && child.children.length > 0 ? (
                  <SidebarMenuItemRecursive
                    key={child.id}
                    item={child}
                    activeItem={activeItem}
                    expandedItems={expandedItems}
                    onToggleExpanded={onToggleExpanded}
                    onItemClick={onItemClick}
                    depth={depth + 1}
                  />
                ) : (
                  <SidebarMenuSubItem key={child.id}>
                    {child.isComingSoon ? (
                      <SidebarMenuSubButton className="opacity-50">
                        <span>{child.title}</span>
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          준비중
                        </Badge>
                      </SidebarMenuSubButton>
                    ) : (
                      <SidebarMenuSubButton
                        asChild
                        isActive={activeItem === child.id || (child.path != null && location.pathname.startsWith(child.path))}
                      >
                        <Link to={child.path ?? "#"} onClick={() => onItemClick(child)}>
                          <span>{child.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    )}
                  </SidebarMenuSubItem>
                ),
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    )
  }

  if (item.isComingSoon) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton className="opacity-50">
          <span>{item.title}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            준비중
          </Badge>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={!!isActive}>
        <Link to={item.path ?? "#"} onClick={() => onItemClick(item)}>
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
