// src/app/(admin)/inventory/status/page.tsx
'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function InventoryStatusPage() {
  return (
      <ComingSoon
        title="재고 현황"
        description="현재 재고 현황을 확인할 수 있는 페이지입니다."
      />
  );
}
