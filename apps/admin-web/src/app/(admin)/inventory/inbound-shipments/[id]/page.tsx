import RouteGuard from '@/components/layout/route-guard';
import { ShipmentDetail } from '@/features/inventory/inbound-shipments/components/shipment-detail';

export default async function InventoryInboundShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard screen="/inventory/inbound-shipments/[id]">
      <ShipmentDetail id={id} />
    </RouteGuard>
  );
}
