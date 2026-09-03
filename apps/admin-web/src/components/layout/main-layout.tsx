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

interface MainLayoutProps {
  children: React.ReactNode;
}

// 이 경로들에 들어가면 사이드바가 자동으로 접힌다 (경로 완전일치 — 하위 상세 페이지는 제외)
const COLLAPSED_SIDEBAR_PATHS = ['/mall/products-list'];

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const [activeMenu, setActiveMenu] = useState('company');
  const [activeItem, setActiveItem] = useState<string | undefined>();

  // 아카이브는 자기 사이드바(문서 트리)를 직접 그리고 화면 높이를 꽉 채운다.
  // 다른 경로의 레이아웃은 그대로 둔다.
  const isArchive = pathname.startsWith('/archive');

  const shouldCollapseSidebar = COLLAPSED_SIDEBAR_PATHS.includes(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(!shouldCollapseSidebar);

  useEffect(() => {
    setSidebarOpen(!shouldCollapseSidebar);
  }, [shouldCollapseSidebar]);

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

  // 회원정보조회 팝업 창
  if (pathname.startsWith('/customer-window')) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      {isArchive ? null : (
        <div className="hidden lg:flex ">
          <AppSidebar
            activeMenu={activeMenu}
            activeItem={activeItem}
            onItemClick={handleItemClick}
          />
        </div>
      )}
      <div
        className={cn(
          'flex flex-col flex-1 min-w-0',
          isArchive && 'h-svh overflow-hidden'
        )}
      >
        <Header
          activeMenu={activeMenu}
          activeItem={activeItem ?? undefined}
          onMenuChange={handleMenuChange}
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
