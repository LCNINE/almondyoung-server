/** @format */

// src/components/layout/main-layout.tsx
'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from './header';
import { AppSidebar } from './app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { type MenuItem, getActiveMenuAndItem } from '@/lib/utils/menu';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const [activeMenu, setActiveMenu] = useState('company');
  const [activeItem, setActiveItem] = useState<string | undefined>();

  useEffect(() => {
    const { menuId, itemId } = getActiveMenuAndItem(pathname);
    if (menuId) {
      setActiveMenu(menuId);
      setActiveItem(itemId || undefined);
    }
  }, [pathname]);

  const handleMenuChange = (menuId: string) => {
    setActiveMenu(menuId);
    setActiveItem(undefined);
  };

  const handleItemClick = (item: MenuItem) => {
    setActiveItem(item.id);
  };

  // 로그인 페이지와 모바일 전용 페이지는 PC 레이아웃 제외
  if (pathname === '/login' || pathname === '/unauthorized') {
    return <>{children}</>;
  }

  // 모바일 전용 페이지들 (/mobile로 시작하는 모든 경로)은 PC 레이아웃 제외
  if (pathname.startsWith('/mobile')) {
    return <>{children}</>;
  }

  // 다이얼로그 전용 페이지들 (/dialog로 시작하는 모든 경로)은 PC 레이아웃 제외
  if (pathname.startsWith('/dialog')) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="hidden lg:flex ">
        <AppSidebar
          activeMenu={activeMenu}
          activeItem={activeItem}
          onItemClick={handleItemClick}
        />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          activeMenu={activeMenu}
          activeItem={activeItem ?? undefined}
          onMenuChange={handleMenuChange}
        />
        <main className="py-4 overflow-y-auto bg-white ">{children}</main>
      </div>
    </SidebarProvider>
  );
}
