'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FulfillmentsTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useShipmentDetail } from '@/lib/services/orders/queries';
import { fulfillmentDetailHref } from './detail-href';

export default function FulfillmentsListTemplate() {
  const router = useRouter();
  const shipmentId = useSearchParams().get('shipmentId') ?? '';
  const { data: shipment } = useShipmentDetail(shipmentId);
  const fulfillmentOrderId = shipment?.lines[0]?.fulfillmentOrderId;

  // 배치 화면의 상자 링크(?shipmentId=)는 그 상자의 출고주문 상세로 보낸다
  useEffect(() => {
    if (fulfillmentOrderId) {
      router.replace(fulfillmentDetailHref(fulfillmentOrderId, shipmentId));
    }
  }, [fulfillmentOrderId, shipmentId, router]);

  return (
    <Container>
      <Header title="출고주문" />
      <FulfillmentsTable />
    </Container>
  );
}
