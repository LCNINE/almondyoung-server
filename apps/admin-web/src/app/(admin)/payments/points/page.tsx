import RouteGuard from '@/components/layout/route-guard';
import PointsTemplate from '@/features/payments/template/points-template';

export default function PointsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PointsTemplate />
      </div>
    </RouteGuard>
  );
}
