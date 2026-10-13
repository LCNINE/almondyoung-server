import RouteGuard from '@/components/layout/route-guard';
import MarketingTimeSaleTemplate from '@/features/mall/marketing/time-sale/template/marketing-time-sale-template';

export default function MarketingTimeSalePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <MarketingTimeSaleTemplate />
    </RouteGuard>
  );
}
