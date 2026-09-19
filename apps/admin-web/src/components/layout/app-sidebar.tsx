/** @format */

// src/components/layout/app-sidebar.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, House } from 'lucide-react';
import {
  getFirstPagePath,
  getMenuById,
  mainMenus,
  type MenuItem,
} from '@/lib/utils/menu';
import { IconComponent } from '@/lib/utils/icons';
import { Badge } from '@/components/ui/badge';
import { useOrderStats } from '@/lib/services/orders';
import { useAdminUserCount } from '@/lib/services/users';
import { usePermission } from '@/hooks/use-permission';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { SidebarMenuItemRecursive } from './sidebar-menu-item';

interface AppSidebarProps {
  activeMenu: string;
  activeItem?: string;
  onItemClick: (item: MenuItem) => void;
  onMenuChange: (menuId: string) => void;
}

// 특정 아이템의 부모 경로를 찾는 함수
function findParentPath(
  items: MenuItem[],
  targetId: string,
  path: string[] = []
): string[] | null {
  for (const item of items) {
    if (item.id === targetId) {
      return path;
    }
    if (item.children) {
      const found = findParentPath(item.children, targetId, [...path, item.id]);
      if (found) return found;
    }
  }
  return null;
}

// requireRole 이 걸린 항목은 해당 role 보유자에게만 노출
function filterMenuByRole(
  items: MenuItem[],
  hasRole: (roles: string[]) => boolean | undefined,
): MenuItem[] {
  return items
    .filter((item) => !item.requireRole || hasRole(item.requireRole) === true)
    .map((item) =>
      item.children
        ? { ...item, children: filterMenuByRole(item.children, hasRole) }
        : item,
    );
}

export function AppSidebar({
  activeMenu,
  activeItem,
  onItemClick,
  onMenuChange,
}: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [browsingAll, setBrowsingAll] = useState(false);

  useEffect(() => {
    setBrowsingAll(false);
  }, [pathname]);

  const currentMenu = getMenuById(activeMenu);

  const { hasRole } = usePermission();
  const visibleChildren = currentMenu
    ? filterMenuByRole(currentMenu.children, hasRole)
    : [];

  // activeItem이 변경될 때 부모 메뉴들을 자동으로 펼침
  useEffect(() => {
    if (activeItem && currentMenu) {
      const parentPath = findParentPath(currentMenu.children, activeItem);
      if (parentPath && parentPath.length > 0) {
        setExpandedItems((prev) => {
          const newExpanded = new Set([...prev, ...parentPath]);
          return Array.from(newExpanded);
        });
      }
    }
  }, [activeItem, currentMenu]);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  };

  const { data: orderStats } = useOrderStats();
  const { data: adminUserCount } = useAdminUserCount();

  // 특별한 정보 표시 (예: 주문/출고관리)
  const getMenuInfo = () => {
    switch (activeMenu) {
      case 'order-shipment':
        return (
          <div className="p-3 bg-sidebar-accent rounded-lg group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-sidebar-foreground">
                오늘 주문수
              </span>
              <Badge variant="default" className="bg-sidebar-primary">
                {orderStats?.todayCount ?? '-'}
              </Badge>
            </div>
          </div>
        );
      case 'company':
        return (
          <div className="p-3 bg-sidebar-accent rounded-lg group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-sidebar-foreground">
                등록된 계정 수
              </span>
              <Badge variant="default" className="bg-sidebar-primary">
                {adminUserCount?.toLocaleString('ko-KR') ?? '-'}
              </Badge>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const goToMenu = (menuId: string) => {
    setBrowsingAll(false);
    onMenuChange(menuId);
    const path = getFirstPagePath(menuId);
    if (path) router.push(path);
  };

  const isHome = pathname === '/';
  const showAll = browsingAll || isHome || !currentMenu;

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="flex-row items-center justify-between p-4 group-data-[collapsible=icon]:px-2">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-sidebar-primary-foreground group-data-[collapsible=icon]:hidden"
        >
          LCNINE
        </Link>
        <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
      </SidebarHeader>

      <SidebarContent>
        {showAll ? (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isHome} tooltip="홈">
                  <Link href="/">
                    <House className="size-4 shrink-0" />
                    <span>홈</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {mainMenus.map((menu) => (
                <SidebarMenuItem key={menu.id}>
                  <SidebarMenuButton
                    tooltip={menu.title}
                    isActive={!isHome && activeMenu === menu.id}
                    onClick={() => goToMenu(menu.id)}
                  >
                    <IconComponent name={menu.icon} className="size-4 shrink-0" />
                    <span>{menu.title}</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <div className="flex min-h-0 flex-1">
            <SidebarMenu className="w-(--sidebar-width-icon) shrink-0 items-center gap-1 border-r border-sidebar-border py-2 group-data-[collapsible=icon]:border-r-0">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={{ children: '홈', hidden: false }}
                  className="size-8 justify-center p-0"
                >
                  <Link href="/" aria-label="홈">
                    <House className="size-4" />
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {mainMenus.map((menu) => (
                <SidebarMenuItem key={menu.id}>
                  <SidebarMenuButton
                    tooltip={{ children: menu.title, hidden: false }}
                    aria-label={menu.title}
                    isActive={activeMenu === menu.id}
                    onClick={() => goToMenu(menu.id)}
                    className="size-8 justify-center p-0"
                  >
                    <IconComponent name={menu.icon} className="size-4" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>

            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto group-data-[collapsible=icon]:hidden">
              <div className="flex flex-col gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setBrowsingAll(true)}
                  className="flex items-center gap-1 text-base font-semibold text-sidebar-primary-foreground"
                >
                  <ChevronLeft className="size-4" />
                  {currentMenu.title}
                </button>
                {getMenuInfo()}
              </div>
              <SidebarGroup className="pt-0">
                <SidebarMenu>
                  {visibleChildren.map((item) => (
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
            </div>
          </div>
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
