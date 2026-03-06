// src/app/(admin)/order/(input)/manual-single/page.tsx
import RouteGuard from '@/components/layout/route-guard';
import ManualSingleOrderPage from '@/features/order/input/manual-single/components';

export default function OrderManualSinglePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']} requiredScope={['admin:access', 'master']}>
      <ManualSingleOrderPage />
    </RouteGuard>
  );
}
