/** @format */

import RouteGuard from '@/components/layout/route-guard';
import OutboundPreparationTemplate from '@/features/order/outbound-preparation/template/OutboundPreparationTemplate';

export default function OrderWaybillIssuePage() {
  return (
    <RouteGuard screen="/order/waybill-issue">
      <OutboundPreparationTemplate />
    </RouteGuard>
  );
}
