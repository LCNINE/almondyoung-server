// src/app/(admin)/cs/return-exchange/page.tsx
'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function ReturnExchangePage() {
  return (
    <ComingSoon
      title="반품/교환"
      description="반품 및 교환을 관리할 수 있는 페이지입니다."
    />
  );
}
