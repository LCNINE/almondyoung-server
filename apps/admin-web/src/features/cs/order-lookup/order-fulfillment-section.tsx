'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FoStatusBadge } from '@/components/table/table-cells/fulfillment/fo-status-cell';
import { shipmentStatusLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';
import { fulfillmentDetailHref } from '@/features/order/fulfillments/template/detail-href';
import { useReadGate } from '@/features/main/read-gate';
import { useFulfillmentShipments } from '@/lib/services/orders/queries';

// 이력 창은 주문 이력 표 모듈에 있다 — 누를 때만 불러온다
const BusinessTimelineModal = dynamic(
  () =>
    import('@/features/order/history/components/table').then(
      (m) => m.BusinessTimelineModal
    ),
  { ssr: false }
);

function FulfillmentShipments({ fo }: { fo: { id: string } }) {
  const gate = useReadGate(['fulfillment.shipment.read']);
  const { data, isPending, isError, refetch } = useFulfillmentShipments(fo.id, {
    enabled: gate.enabled,
  });

  if (!gate.enabled) return null;
  if (isPending)
    return <p className="text-xs text-gray-500">상자를 불러오는 중…</p>;
  if (isError) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-600">
        <span>상자를 불러오지 못했어요.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
        >
          다시 시도
        </Button>
      </div>
    );
  }
  // 합친 뒤 남은 옛 상자는 쓰지 않는 상자라 보이지 않는다
  const boxes = data.filter((s) => s.status !== 'superseded');
  if (boxes.length === 0)
    return <p className="text-xs text-gray-500">아직 상자가 없어요.</p>;

  return (
    <ul className="flex flex-col gap-1">
      {boxes.map((s) => (
        <li key={s.id} className="text-xs">
          <Link
            href={fulfillmentDetailHref(fo.id, s.id)}
            className="text-primary underline"
          >
            상자 <span className="font-mono">{s.id.slice(0, 8)}</span> ·{' '}
            {shipmentStatusLabel(s.status)} — 배송·송장 보기
          </Link>
        </li>
      ))}
    </ul>
  );
}

type FulfillmentRef = { id: string; status: string };

/** CS 주문조회의 «출고» — 이 주문의 출고주문·상자·처리 이력으로 바로 간다 */
export function OrderFulfillmentSection({
  orderId,
  orderNo,
  fulfillmentOrder,
}: {
  orderId: string;
  orderNo: string;
  /** 주문 상세 응답이 싣는다. undefined 는 이 값을 싣지 않는 옛 응답이다 */
  fulfillmentOrder: FulfillmentRef | null | undefined;
}) {
  const gate = useReadGate(['fulfillment.order.read']);
  const [timelineOpen, setTimelineOpen] = useState(false);

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">출고</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTimelineOpen(true)}
        >
          주문 이력 보기
        </Button>
      </div>
      {fulfillmentOrder === undefined || gate.pending ? null : gate.failed ? (
        <p className="text-sm text-gray-500">
          권한을 확인하지 못해 출고주문을 보이지 않았어요. 새로고침해 주세요.
        </p>
      ) : !gate.enabled ? (
        <p className="text-sm text-gray-500">출고주문을 볼 권한이 없어요.</p>
      ) : fulfillmentOrder === null ? (
        <p className="text-sm text-gray-500">아직 출고주문이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <FoStatusBadge status={fulfillmentOrder.status} />
            <Link
              href={fulfillmentDetailHref(fulfillmentOrder.id)}
              className="text-sm text-primary underline"
            >
              출고주문 상세
            </Link>
          </div>
          <FulfillmentShipments fo={fulfillmentOrder} />
        </div>
      )}
      {timelineOpen && (
        <BusinessTimelineModal
          order={{ orderId, orderNo }}
          open={timelineOpen}
          onOpenChange={setTimelineOpen}
        />
      )}
    </section>
  );
}
