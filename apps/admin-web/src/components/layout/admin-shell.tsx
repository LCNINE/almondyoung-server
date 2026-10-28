/** @format */

// src/components/layout/main-layout.tsx
'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from './header';
import { AppSidebar } from './app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils/ui';
import { type MenuItem, getActiveMenuAndItem } from '@/lib/utils/menu';

const SIDEBAR_AUTO_COLLAPSE_BELOW = 1600;

interface AdminShellProps {
  banner?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({ children, banner }: AdminShellProps) {
  const pathname = usePathname();
  const [activeMenu, setActiveMenu] = useState('company');
  const [activeItem, setActiveItem] = useState<string | undefined>();

  // 아카이브는 자기 사이드바(문서 트리)를 직접 그리고 화면 높이를 꽉 채운다.
  // 다른 경로의 레이아웃은 그대로 둔다.
  const isArchive = pathname.startsWith('/archive');

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 노트북 폭에서는 하위 메뉴를 접어 표가 쓸 폭을 넓힌다. 직접 펼친 건 폭이 다시 경계를 넘을 때까지 그대로 둔다.
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${SIDEBAR_AUTO_COLLAPSE_BELOW}px)`);
    setSidebarOpen(wide.matches);
    const onChange = (e: MediaQueryListEvent) => setSidebarOpen(e.matches);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const { menuId, itemId } = getActiveMenuAndItem(pathname);
    if (menuId) {
      setActiveMenu(menuId);
      setActiveItem(itemId || undefined);
    }

    if (pathname === '/') {
      setSidebarOpen(true);
    }
  }, [pathname]);

  const handleMenuChange = (menuId: string) => {
    setActiveMenu(menuId);
    setActiveItem(undefined);
  };

  const handleItemClick = (item: MenuItem) => {
    setActiveItem(item.id);
  };

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      {isArchive ? null : (
        <div className="hidden lg:flex ">
          <AppSidebar
            activeMenu={activeMenu}
            activeItem={activeItem}
            onItemClick={handleItemClick}
            onMenuChange={handleMenuChange}
          />
        </div>
      )}
      <div
        className={cn(
          'flex flex-col flex-1 min-w-0',
          isArchive && 'h-svh overflow-hidden'
        )}
      >
        {banner}
        <Header
          activeMenu={activeMenu}
          activeItem={activeItem ?? undefined}
          onMenuChange={handleMenuChange}
          withSidebar={!isArchive}
        />
        <main
          className={cn(
            'bg-white',
            isArchive ? 'flex-1 min-h-0 overflow-hidden' : 'py-4'
          )}
        >
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
