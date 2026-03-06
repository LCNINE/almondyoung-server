// src/app/(admin)/cs/management/page.tsx
'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function CSManagementPage() {
  return (
    <ComingSoon
      title="CS 관리"
      description="고객 서비스를 관리할 수 있는 페이지입니다."
    />
  );
}
