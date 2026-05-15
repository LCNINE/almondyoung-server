import RouteGuard from '@/components/layout/route-guard';
import MarketingPointsTemplate from '@/features/mall/marketing/points/template/marketing-points-template';

export default function MarketingPointsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MarketingPointsTemplate />
      </div>
    </RouteGuard>
  );
}
