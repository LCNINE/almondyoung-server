// src/app/(admin)/order/(input)/manual-bulk/page.tsx
'use client';

import RouteGuard from '@/components/layout/route-guard';
import ManualBulkOrderPage from '@/features/order/input/manual-bulk/components';

export default function OrderManualBulkPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <ManualBulkOrderPage />
    </RouteGuard>
  );
}
