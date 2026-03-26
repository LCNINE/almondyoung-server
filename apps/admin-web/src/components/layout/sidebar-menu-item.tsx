/** @format */

// src/components/layout/sidebar-menu-item.tsx
'use client';

import Link from 'next/link';
import { ChevronRight, Folder, FileText } from 'lucide-react';
import { type MenuItem } from '@/lib/utils/menu';
import { Badge } from '@/components/ui/badge';
import { IconComponent } from '@/lib/utils/icons';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar';

interface SidebarMenuItemRecursiveProps {
  item: MenuItem;
  activeItem?: string;
  expandedItems: string[];
  onToggleExpanded: (itemId: string) => void;
  onItemClick: (item: MenuItem) => void;
  level?: number;
}

export function SidebarMenuItemRecursive({
  item,
  activeItem,
  expandedItems,
  onToggleExpanded,
  onItemClick,
  level = 0,
}: SidebarMenuItemRecursiveProps) {
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedItems.includes(item.id);
  const isActive = activeItem === item.id;
  const isComingSoon = item.isComingSoon;

  // 아이콘 렌더링 헬퍼
  const renderIcon = () => {
    if (item.icon) {
      return <IconComponent name={item.icon} className="size-4 shrink-0" />;
    }
    if (hasChildren) {
      return <Folder className="size-4 shrink-0" />;
    }
    return <FileText className="size-4 shrink-0" />;
  };

  // 최상위 메뉴 아이템 (level 0)
  if (level === 0) {
    if (hasChildren) {
      return (
        <Collapsible
          open={isExpanded}
          onOpenChange={() => onToggleExpanded(item.id)}
          className="group/collapsible"
        >
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip={item.title}
                disabled={isComingSoon}
                className="font-semibold"
              >
                {renderIcon()}
                <span className="group-data-[collapsible=icon]:hidden">
                  {item.title}
                </span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
                {isComingSoon && (
                  <Badge variant="secondary" className="ml-auto text-xs group-data-[collapsible=icon]:hidden">
                    준비중
                  </Badge>
                )}
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {item.children?.map((child) => (
                  <SidebarMenuItemRecursive
                    key={child.id}
                    item={child}
                    activeItem={activeItem}
                    expandedItems={expandedItems}
                    onToggleExpanded={onToggleExpanded}
                    onItemClick={onItemClick}
                    level={level + 1}
                  />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      );
    }

    // 최상위 레벨이지만 children이 없는 경우
    return (
      <SidebarMenuItem>
        {item.path ? (
          <SidebarMenuButton
            asChild
            isActive={isActive}
            tooltip={item.title}
            disabled={isComingSoon}
            className="font-semibold"
          >
            <Link href={item.path} onClick={() => onItemClick(item)}>
              {renderIcon()}
              <span className="group-data-[collapsible=icon]:hidden">
                {item.title}
              </span>
              {isComingSoon && (
                <Badge variant="secondary" className="ml-auto text-xs group-data-[collapsible=icon]:hidden">
                  준비중
                </Badge>
              )}
            </Link>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton
            isActive={isActive}
            tooltip={item.title}
            disabled={isComingSoon}
            className="font-semibold"
            onClick={() => onItemClick(item)}
          >
            {renderIcon()}
            <span className="group-data-[collapsible=icon]:hidden">
              {item.title}
            </span>
            {isComingSoon && (
              <Badge variant="secondary" className="ml-auto text-xs group-data-[collapsible=icon]:hidden">
                준비중
              </Badge>
            )}
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    );
  }

  // 하위 메뉴 아이템 (level > 0)
  if (hasChildren) {
    return (
      <Collapsible
        open={isExpanded}
        onOpenChange={() => !isComingSoon && onToggleExpanded(item.id)}
        className="group/collapsible"
      >
        <SidebarMenuSubItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuSubButton
              aria-disabled={isComingSoon}
              className={isComingSoon ? 'opacity-50 pointer-events-none' : ''}
            >
              <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              <span>{item.title}</span>
              {isComingSoon && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  준비중
                </Badge>
              )}
            </SidebarMenuSubButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.children?.map((child) => (
                <SidebarMenuItemRecursive
                  key={child.id}
                  item={child}
                  activeItem={activeItem}
                  expandedItems={expandedItems}
                  onToggleExpanded={onToggleExpanded}
                  onItemClick={onItemClick}
                  level={level + 1}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuSubItem>
      </Collapsible>
    );
  }

  // 하위 메뉴의 리프 노드
  return (
    <SidebarMenuSubItem>
      {item.path && !isComingSoon ? (
        <SidebarMenuSubButton asChild isActive={isActive}>
          <Link href={item.path} onClick={() => onItemClick(item)}>
            <span>{item.title}</span>
          </Link>
        </SidebarMenuSubButton>
      ) : (
        <SidebarMenuSubButton
          isActive={isActive}
          aria-disabled={isComingSoon}
          className={isComingSoon ? 'opacity-50 pointer-events-none' : ''}
          onClick={() => !isComingSoon && onItemClick(item)}
        >
          <span>{item.title}</span>
          {isComingSoon && (
            <Badge variant="secondary" className="ml-auto text-xs">
              준비중
            </Badge>
          )}
        </SidebarMenuSubButton>
      )}
    </SidebarMenuSubItem>
  );
}
