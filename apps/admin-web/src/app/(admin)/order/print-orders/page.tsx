import RouteGuard from '@/components/layout/route-guard';
import PrintOrdersTemplate from '@/features/order/print-orders/template';

export default function PrintOrdersPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <PrintOrdersTemplate />
    </RouteGuard>
  );
}
