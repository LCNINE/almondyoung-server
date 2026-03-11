import RouteGuard from '@/components/layout/route-guard';
import PickingListTemplate from '@/features/order/picking-list/template/PickingListTemplate';

// 피킹 리스트 페이지(pc)
export default function OrderPickingListPage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
    >
      <PickingListTemplate />
    </RouteGuard>
  );
}
