import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import CsOrderLookup from '@/features/cs/order-lookup';

// /cs?orderId=<판매주문 내부 ID>&orderNo=<채널 주문번호>
// 주문 이력 목록의 주문번호 링크로 진입하는 CS 주문조회 페이지.
export default function CsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1100px] flex-col gap-y-2 p-3">
        <Suspense
          fallback={<div className="p-4 text-sm text-gray-500">불러오는 중…</div>}
        >
          <CsOrderLookup />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
