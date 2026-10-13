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
import { guardedNavigate, navigateTo } from '@/lib/navigation-guard';
import { IconComponent } from '@/lib/utils/icons';
import { Badge } from '@/components/ui/badge';
import { useOrderStats } from '@/lib/services/orders';
import { useAdminUserCount } from '@/lib/services/users';
import { usePermissions, useCan } from '@/hooks/use-permission';
import { filterMenuItems, firstAccessiblePathIn } from '@/lib/auth/screen-access';
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
  useSidebar,
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

export function AppSidebar({
  activeMenu,
  activeItem,
  onItemClick,
  onMenuChange,
}: AppSidebarProps) {
  const router = useRouter();
  const { setOpen } = useSidebar();
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [browsingAll, setBrowsingAll] = useState(false);

  useEffect(() => {
    setBrowsingAll(false);
  }, [pathname]);

  const currentMenu = getMenuById(activeMenu);

  // 메뉴는 화면 진입과 같은 경로 권한표로 거른다. 권한을 받기 전엔 비워 둔다(다 보였다 숨기지 않는다).
  const { status: permissionStatus, permissions } = usePermissions();
  const permissionsReady = permissionStatus === 'ready';
  const visibleChildren =
    currentMenu && permissionsReady ? filterMenuItems(currentMenu.children, permissions) : [];
  const visibleMainMenus = permissionsReady
    ? mainMenus.filter((menu) => filterMenuItems(menu.children, permissions).length > 0)
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

  // 배지는 그 메뉴가 보이는 사람에게만 조회한다 — 권한 없는 사람이 셸에서 403 을 내지 않게.
  const canSeeOrderStats = useCan(['order.order.read']);
  const canSeeAccounts = useCan(['customer.profile.read']);
  const { data: orderStats } = useOrderStats({
    enabled: canSeeOrderStats.status === 'ready' && canSeeOrderStats.allowed,
  });
  const { data: adminUserCount } = useAdminUserCount({
    enabled: canSeeAccounts.status === 'ready' && canSeeAccounts.allowed,
  });

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
    const menu = getMenuById(menuId);
    const path = menu && permissionsReady ? firstAccessiblePathIn(menu, permissions) : getFirstPagePath(menuId);
    // 이동이 승인된 뒤에만 메뉴 상태를 바꾼다(취소하면 사이드바 그대로).
    guardedNavigate(() => {
      setBrowsingAll(false);
      onMenuChange(menuId);
      if (path) navigateTo(router, path);
    });
  };

  const isHome = pathname === '/';
  // 권한으로 하위 메뉴가 하나도 안 남은 메뉴(권한 없는 화면에 직접 들어온 경우)는 빈 제목 대신 전체 목록을 보인다.
  const showAll = browsingAll || isHome || !currentMenu || (permissionsReady && visibleChildren.length === 0);

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
              {visibleMainMenus.map((menu) => (
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
              {visibleMainMenus.map((menu) => (
                <SidebarMenuItem key={menu.id}>
                  <SidebarMenuButton
                    tooltip={{ children: menu.title, hidden: false }}
                    aria-label={menu.title}
                    isActive={activeMenu === menu.id}
                    onClick={() =>
                      // 지금 메뉴의 아이콘은 첫 페이지로 보내지 않고 접힌 하위 메뉴만 펼친다
                      activeMenu === menu.id ? setOpen(true) : goToMenu(menu.id)
                    }
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
