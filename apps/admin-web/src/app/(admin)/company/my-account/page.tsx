// src/app/(admin)/company/my-account/page.tsx
'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function MyAccountPage() {
  return (
    <ComingSoon
      title="내 계정"
      description="내 계정 정보를 관리할 수 있는 페이지입니다."
    />
  );
}
