'use client';

import { use } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import { ShipmentDetail } from '@/features/inventory/inbound-shipments/components/shipment-detail';

export default function InventoryInboundShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <RouteGuard screen="/inventory/inbound-shipments/[id]">
      <ShipmentDetail id={id} />
    </RouteGuard>
  );
}
