'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  Crown,
  CreditCard,
  Headphones,
  Menu,
  Package,
  ShoppingBag,
  Store,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils/ui';
import { mainMenus, type MainMenu, type MenuItem } from '@/lib/utils/menu';

const iconMap: Record<string, React.ElementType> = {
  Users,
  Building2,
  Package,
  ShoppingBag,
  Boxes,
  Headphones,
  BarChart3,
  Store,
  Crown,
  CreditCard,
};

interface MobileNavProps {
  activeMenu: string;
  activeItem?: string;
  onMenuChange: (menuId: string) => void;
}

function NavSection({
  item,
  activeItem,
  depth,
  onNavigate,
}: {
  item: MenuItem;
  activeItem?: string;
  depth: number;
  onNavigate: (path: string, menuId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = activeItem === item.id;

  if (!hasChildren) {
    return (
      <button
        onClick={() => item.path && !item.isComingSoon && onNavigate(item.path)}
        disabled={!item.path || item.isComingSoon}
        className={cn(
          'w-full text-left px-3 py-2 text-sm rounded-md transition-colors',
          depth === 2 && 'pl-6',
          depth === 3 && 'pl-9',
          isActive
            ? 'bg-blue-50 text-blue-600 font-medium'
            : 'text-gray-700 hover:bg-gray-100',
          (!item.path || item.isComingSoon) && 'opacity-40 cursor-not-allowed hover:bg-transparent',
        )}
      >
        {item.title}
        {item.isComingSoon && (
          <span className="ml-1.5 text-xs text-gray-400">(준비중)</span>
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors',
          depth === 2 && 'pl-6',
          depth === 3 && 'pl-9',
          'text-gray-500 font-medium hover:bg-gray-50',
        )}
      >
        <span>{item.title}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 transition-transform shrink-0',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {item.children!.map((child) => (
            <NavSection
              key={child.id}
              item={child}
              activeItem={activeItem}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TopMenuSection({
  menu,
  isActive,
  activeItem,
  onNavigate,
}: {
  menu: MainMenu;
  isActive: boolean;
  activeItem?: string;
  onNavigate: (path: string, menuId: string) => void;
}) {
  const [expanded, setExpanded] = useState(isActive);
  const Icon = iconMap[menu.icon];

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-colors',
          isActive ? 'text-blue-600 bg-blue-50/60' : 'text-gray-800 hover:bg-gray-50',
        )}
      >
        {Icon && <Icon className="w-4 h-4 shrink-0" />}
        <span className="flex-1 text-left">{menu.title}</span>
        <ChevronDown
          className={cn('w-4 h-4 transition-transform shrink-0', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="pb-2 space-y-0.5 px-1">
          {menu.children.map((item) => (
            <NavSection
              key={item.id}
              item={item}
              activeItem={activeItem}
              depth={2}
              onNavigate={(path) => onNavigate(path, menu.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MobileNav({ activeMenu, activeItem, onMenuChange }: MobileNavProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleNavigate = (path: string, menuId: string) => {
    onMenuChange(menuId);
    router.push(path);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden shrink-0"
        onClick={() => setOpen(true)}
        aria-label="메뉴 열기"
      >
        <Menu className="w-5 h-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          <SheetTitle className="sr-only">네비게이션 메뉴</SheetTitle>
          <div className="px-4 py-4 border-b border-gray-100">
            <span className="text-lg font-bold text-blue-600 tracking-tight">LCNINE</span>
          </div>
          <nav className="flex-1 overflow-y-auto">
            {mainMenus.map((menu) => (
              <TopMenuSection
                key={menu.id}
                menu={menu}
                isActive={activeMenu === menu.id}
                activeItem={activeItem}
                onNavigate={handleNavigate}
              />
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
