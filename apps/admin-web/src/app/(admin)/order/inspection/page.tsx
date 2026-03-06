import RouteGuard from '@/components/layout/route-guard';
import InspectionTemplate from '@/features/order/inspection/template/inspection-template';

export default function OrderInspectionPage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
      requiredScope={['admin:access', 'master']}
    >
      <InspectionTemplate />
    </RouteGuard>
  );
}
