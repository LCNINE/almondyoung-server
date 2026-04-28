import RouteGuard from '@/components/layout/route-guard';
import LocationOptimizationTemplate from '@/features/order/location-optimization/template';

export default function LocationOptimizationPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <LocationOptimizationTemplate />
      </div>
    </RouteGuard>
  );
}
