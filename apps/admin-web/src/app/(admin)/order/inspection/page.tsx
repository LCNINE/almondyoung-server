import RouteGuard from '@/components/layout/route-guard';
import InspectionTemplate from '@/features/order/inspection/template';

export default function OrderInspectionPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <InspectionTemplate />
      </div>
    </RouteGuard>
  );
}
