/** @format */

// src/components/layout/main-layout.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Header } from './header';
import { AppSidebar } from './app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils/ui';
import { type MenuItem, getActiveMenuAndItem } from '@/lib/utils/menu';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const [activeMenu, setActiveMenu] = useState('company');
  const [activeItem, setActiveItem] = useState<string | undefined>();

  // 아카이브는 자기 사이드바(문서 트리)를 직접 그리고 화면 높이를 꽉 채운다.
  // 다른 경로의 레이아웃은 그대로 둔다.
  const isArchive = pathname.startsWith('/archive');

  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const demoBanner = process.env.NEXT_PUBLIC_APP_STAGE === 'demo' && (
    <div className="flex items-center justify-between gap-3 bg-amber-100 px-5 py-2 text-sm text-amber-950">
      <span>
        <strong>DEMO</strong> · 시연 데이터 · 택배와 알림은 모의 처리됩니다.
      </span>
      <Link href="/demo" className="shrink-0 whitespace-nowrap font-semibold underline">
        시연 콘솔
      </Link>
    </div>
  );

  // 로그인 페이지와 모바일 전용 페이지는 PC 레이아웃 제외
  if (pathname === '/login' || pathname === '/unauthorized') {
    return (
      <>
        {demoBanner}
        {children}
      </>
    );
  }

  // 모바일 전용 페이지들 (/mobile로 시작하는 모든 경로)은 PC 레이아웃 제외
  if (pathname.startsWith('/mobile')) {
    return (
      <>
        {demoBanner}
        {children}
      </>
    );
  }

  // 다이얼로그 전용 페이지들 (/dialog로 시작하는 모든 경로)은 PC 레이아웃 제외
  if (pathname.startsWith('/dialog')) {
    return (
      <>
        {demoBanner}
        {children}
      </>
    );
  }

  // 회원정보조회 팝업 창
  if (pathname.startsWith('/customer-window')) {
    return (
      <>
        {demoBanner}
        {children}
      </>
    );
  }

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
        {demoBanner}
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
