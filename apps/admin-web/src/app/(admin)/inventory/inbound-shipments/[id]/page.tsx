import RouteGuard from '@/components/layout/route-guard';

// Task 8 이 상세 화면을 채운다.
export default function InventoryInboundShipmentDetailPage() {
  return (
    <RouteGuard screen="/inventory/inbound-shipments/[id]">
      <div className="p-3 text-sm text-muted-foreground">선적 상세</div>
    </RouteGuard>
  );
}
