/** @format */

// src/components/layout/main-layout.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Breadcrumb } from '@/components/common/breadcrumb';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { type MenuItem, getActiveMenuAndItem } from '@/lib/utils/menu';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const router = useRouter();
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
    if (item.path) {
      router.push(item.path);
    }
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
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* 헤더 */}
      <Header activeMenu={activeMenu} onMenuChange={handleMenuChange} />
      {/* 사이드바 + 메인 */}
      <div className="flex flex-1">
        <Sidebar
          activeMenu={activeMenu}
          activeItem={activeItem}
          onItemClick={handleItemClick}
        />
        <main className="flex-1 bg-white overflow-y-auto">
          {/* <Breadcrumb /> */}
          {children}
        </main>
      </div>
    </div>
  );
}
