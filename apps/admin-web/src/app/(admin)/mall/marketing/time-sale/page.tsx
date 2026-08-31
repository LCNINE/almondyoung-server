import RouteGuard from '@/components/layout/route-guard';
import MarketingTimeSaleTemplate from '@/features/mall/marketing/time-sale/template/marketing-time-sale-template';

export default function MarketingTimeSalePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MarketingTimeSaleTemplate />
      </div>
    </RouteGuard>
  );
}
