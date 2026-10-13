import RouteGuard from '@/components/layout/route-guard';
import MarketingCouponsTemplate from '@/features/mall/marketing/coupons/template/marketing-coupons-template';

export default function MarketingCouponsPage() {
  return (
    <RouteGuard screen="/mall/marketing/coupons">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MarketingCouponsTemplate />
      </div>
    </RouteGuard>
  );
}
