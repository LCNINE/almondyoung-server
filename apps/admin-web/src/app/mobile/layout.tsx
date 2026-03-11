/** @format */

'use client';

import RouteGuard from '@/components/layout/route-guard';
import MobileBottomNavigation from '@/components/mobile/bottom-navigation';

interface MobileLayoutProps {
  children: React.ReactNode;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <RouteGuard requireRole={['admin', 'master']}>
        {/* Mobile-specific layout wrapper - 모바일 전용 페이지들만 사용 */}
        <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      </RouteGuard>

      {/* Bottom Navigation */}
      <MobileBottomNavigation />
    </div>
  );
}
