/** @format */

import RouteGuard from '@/components/layout/route-guard';
import { CarrierAttentionLine } from '@/features/order/carrier-tracking/carrier-attention-line';
import OutboundPreparationTemplate from '@/features/order/outbound-preparation/template/OutboundPreparationTemplate';

export default function OrderWaybillIssuePage() {
  return (
    <RouteGuard screen="/order/waybill-issue">
      <CarrierAttentionLine />
      <OutboundPreparationTemplate />
    </RouteGuard>
  );
}
