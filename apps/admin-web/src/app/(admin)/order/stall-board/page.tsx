// src/app/(admin)/order/stall-board/page.tsx

import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import StallBoardTemplate from '@/features/order/stall-board/template';

export default function StallBoardPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      {/* 템플릿이 useSearchParams 로 ?stage= 를 읽는다 */}
      <Suspense>
        <StallBoardTemplate />
      </Suspense>
    </RouteGuard>
  );
}
