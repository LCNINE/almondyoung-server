// src/app/(admin)/order/history/page.tsx

import RouteGuard from '@/components/layout/route-guard';
import { Spinner } from '@/components/ui/spinner';
import OrderHistoryTemplate from '@/features/order/history/template';
import { Suspense } from 'react';

export default function OrderHistoryPage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
    >
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen">
            <Spinner size="lg" className="w-10 h-10" />
          </div>
        }
      >
        <OrderHistoryTemplate />
      </Suspense>
    </RouteGuard>
  );
}
