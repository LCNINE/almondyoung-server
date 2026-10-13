import RouteGuard from '@/components/layout/route-guard';
import MarketingTimeSaleTemplate from '@/features/mall/marketing/time-sale/template/marketing-time-sale-template';

export default function MarketingTimeSalePage() {
  return (
    <RouteGuard screen="/mall/marketing/time-sale">
      <MarketingTimeSaleTemplate />
    </RouteGuard>
  );
}
