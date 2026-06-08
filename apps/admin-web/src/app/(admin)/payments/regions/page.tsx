import RouteGuard from '@/components/layout/route-guard';
import RegionsTemplate from '@/features/payment-config/regions-template';

export default function RegionsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <RegionsTemplate />
      </div>
    </RouteGuard>
  );
}
