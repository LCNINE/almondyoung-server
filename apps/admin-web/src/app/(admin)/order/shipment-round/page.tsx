/** @format */

import RouteGuard from '@/components/layout/route-guard';
import ShipmentRoundTemplate from '@/features/order/shipment-round/template/ShipmentRoundTemplate';

// 송장 출력 / 출고 회차별 조회 페이지
export default function OrderShipmentRoundPage() {
  return (
    <RouteGuard
      screen="/order/shipment-round"
    >
      <ShipmentRoundTemplate />
    </RouteGuard>
  );
}
