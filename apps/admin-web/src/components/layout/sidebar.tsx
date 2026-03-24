/** @format */

// src/components/layout/sidebar.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMenuById, type MenuItem } from '@/lib/utils/menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/ui';

interface SidebarProps {
  activeMenu: string;
  activeItem?: string;
  onItemClick: (item: MenuItem) => void;
}

export function Sidebar({ activeMenu, activeItem, onItemClick }: SidebarProps) {
  const router = useRouter();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const currentMenu = getMenuById(activeMenu);

  if (!currentMenu) {
    return (
      <aside className="w-80 bg-slate-800 text-white p-6">
        <div className="text-slate-400">메뉴를 선택해주세요</div>
      </aside>
    );
  }

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  };

  const handleItemClick = (item: MenuItem) => {
    console.log('Sidebar item clicked:', item.title, item.path); // 디버깅용
    onItemClick(item);
    if (item.path) {
      router.push(item.path);
    }
  };

  const renderMenuItem = (item: MenuItem, level = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.id);
    const isActive = activeItem === item.id;
    const isComingSoon = item.isComingSoon;

    return (
      <div key={item.id} className="mb-1">
        <Collapsible
          open={isExpanded}
          onOpenChange={() => hasChildren && toggleExpanded(item.id)}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'w-full justify-start text-left font-normal h-auto p-3',
                level === 0 && 'text-base font-semibold',
                level === 1 && 'text-sm ml-4',
                level === 2 && 'text-sm ml-8',
                isActive &&
                  'bg-blue-600 text-white hover:bg-blue-700 hover:text-white',
                !isActive &&
                  'text-slate-300 hover:bg-slate-700 hover:text-white',
                isComingSoon && 'text-slate-500'
              )}
              onClick={() => {
                if (!hasChildren) {
                  handleItemClick(item);
                }
              }}
              disabled={isComingSoon}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center">
                  {hasChildren &&
                    (isExpanded ? (
                      <ChevronDown className="w-4 h-4 mr-2" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    ))}
                  <span>{item.title}</span>
                  {isComingSoon && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      준비중
                    </Badge>
                  )}
                </div>
                {item.id === 'my-account' && (
                  <Badge variant="default" className="text-xs">
                    14
                  </Badge>
                )}
              </div>
            </Button>
          </CollapsibleTrigger>

          {hasChildren && (
            <CollapsibleContent className="space-y-1">
              {item.children?.map((child) => renderMenuItem(child, level + 1))}
            </CollapsibleContent>
          )}
        </Collapsible>
      </div>
    );
  };

  // 특별한 정보 표시 (예: 주문/출고관리)
  const getMenuInfo = () => {
    switch (activeMenu) {
      case 'order-shipment':
        return (
          <div className="mb-6 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">
                오늘 주문수
              </span>
              <Badge variant="default" className="bg-blue-600">
                567
              </Badge>
            </div>
          </div>
        );
      case 'company':
        return (
          <div className="mb-6 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">
                등록된 계정 수
              </span>
              <Badge variant="default">14</Badge>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <aside className="w-80 bg-slate-800 text-white p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">
          {currentMenu.title}
        </h2>
        {getMenuInfo()}
      </div>

      <nav className="space-y-1">
        {currentMenu.children.map((item) => renderMenuItem(item))}
      </nav>
    </aside>
  );
}
