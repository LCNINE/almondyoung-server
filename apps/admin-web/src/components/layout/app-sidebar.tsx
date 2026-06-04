/** @format */

// src/components/layout/app-sidebar.tsx
'use client';

import { useState, useEffect } from 'react';
import { getMenuById, type MenuItem } from '@/lib/utils/menu';
import { Badge } from '@/components/ui/badge';
import { useOrderStats } from '@/lib/services/orders';
import { useAdminUserCount } from '@/lib/services/users';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { SidebarMenuItemRecursive } from './sidebar-menu-item';

interface AppSidebarProps {
  activeMenu: string;
  activeItem?: string;
  onItemClick: (item: MenuItem) => void;
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
}: AppSidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const currentMenu = getMenuById(activeMenu);

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
    );
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
        {getMenuInfo()}
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
  );
}
