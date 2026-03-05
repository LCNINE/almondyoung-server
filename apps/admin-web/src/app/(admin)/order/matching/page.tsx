// src/app/(admin)/order/matching/page.tsx
// 주문 매칭 페이지

import { FilterProvider } from '@/features/order/matching/contexts/filter.context';
import MatchingTemplate from '@/features/order/matching/template/Matching';
import RouteGuard from '@/components/layout/route-guard';

export default function OrderMatchingPage() {
  return (
    // <RouteGuard
    //   requireRole={['admin', 'master']}
    //   requiredScope={['admin:access', 'master']}
    // >
    <FilterProvider>
      <MatchingTemplate />
    </FilterProvider>
    // </RouteGuard>
  );
}
