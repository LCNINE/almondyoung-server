import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { ShipmentList } from '@/features/inventory/inbound-shipments/components/shipment-list';

export default function InventoryInboundShipmentsPage() {
  return (
    <RouteGuard screen="/inventory/inbound-shipments">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Container>
          <Header title="선적 입고" subtitle="입고리스트를 올리고 선적을 확인합니다." />
          <Suspense>
            <ShipmentList />
          </Suspense>
        </Container>
      </div>
    </RouteGuard>
  );
}
