'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { FoStatusBadge } from '@/components/table/table-cells/fulfillment/fo-status-cell';
import { shipmentStatusLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';
import { fulfillmentDetailHref } from '@/features/order/fulfillments/template/detail-href';
import { StockPriorityBadge } from '@/features/order/stock-priority/stock-priority-badge';
import {
  StockPriorityCancelDialog,
  StockPriorityDialog,
} from '@/features/order/stock-priority/stock-priority-dialog';
import { useReadGate } from '@/features/main/read-gate';
import {
  useCancelStockPriority,
  useSetStockPriority,
} from '@/lib/services/orders/mutations';
import { useFulfillmentShipments } from '@/lib/services/orders/queries';

// 이력 창은 주문 이력 표 모듈에 있다 — 누를 때만 불러온다
const BusinessTimelineModal = dynamic(
  () =>
    import('@/features/order/history/components/table').then(
      (m) => m.BusinessTimelineModal
    ),
  { ssr: false }
);

function FulfillmentShipments({
  fo,
  orderNo,
}: {
  fo: { id: string };
  orderNo: string;
}) {
  const [prioritizing, setPrioritizing] = useState<{
    shipmentId: string;
    cancel: boolean;
  } | null>(null);
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
    <>
      <ul className="flex flex-col gap-1">
        {boxes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={fulfillmentDetailHref(fo.id, s.id)}
              className="text-primary underline"
            >
              상자 <span className="font-mono">{s.id.slice(0, 8)}</span> ·{' '}
              {shipmentStatusLabel(s.status)} — 배송·송장 보기
            </Link>
            {s.status === 'draft' && s.supplierId === null && (
              <>
                <span className="tabular-nums text-gray-500">
                  재고 {s.reservedQty}/{s.totalQty}
                </span>
                {s.stockPriority ? (
                  <>
                    <StockPriorityBadge />
                    <Can run={useCancelStockPriority}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPrioritizing({ shipmentId: s.id, cancel: true })
                        }
                      >
                        우선할당 취소
                      </Button>
                    </Can>
                  </>
                ) : (
                  s.stockPriority === false &&
                  s.reservedQty < s.totalQty && (
                    <Can run={useSetStockPriority}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPrioritizing({ shipmentId: s.id, cancel: false })
                        }
                      >
                        우선할당
                      </Button>
                    </Can>
                  )
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {prioritizing &&
        (prioritizing.cancel ? (
          <StockPriorityCancelDialog
            shipmentId={prioritizing.shipmentId}
            orderText={`#${orderNo}`}
            onClose={() => setPrioritizing(null)}
          />
        ) : (
          <StockPriorityDialog
            shipmentId={prioritizing.shipmentId}
            orderText={`#${orderNo}`}
            onClose={() => setPrioritizing(null)}
          />
        ))}
    </>
  );
}

type FulfillmentRef = { id: string; status: string };
type LineRouteCounts = {
  warehouse: number;
  outsourced: number;
  digital: number;
};

/** 출고주문에 들어가지 않는 상품이 어떻게 나가는지 */
function OffWarehouseNotes({ counts }: { counts: LineRouteCounts }) {
  const printGate = useReadGate(['order.order.read']);
  if (counts.outsourced === 0 && counts.digital === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-gray-500">
      {counts.outsourced > 0 && (
        <li>
          인쇄 상품은 출고주문에 들어가지 않고 인쇄소가 고객에게 바로 보내요.
          {printGate.enabled &&
            ' 진행은 아래 주문 상품의 인쇄 정보에서 볼 수 있어요.'}
        </li>
      )}
      {counts.digital > 0 && (
        <li>디지털 상품은 배송 없이 제공돼서 출고주문에 들어가지 않아요.</li>
      )}
    </ul>
  );
}

/** CS 주문조회의 «출고» — 이 주문의 출고주문·상자·처리 이력으로 바로 간다 */
export function OrderFulfillmentSection({
  orderId,
  orderNo,
  fulfillmentOrder,
  lineRouteCounts,
}: {
  orderId: string;
  orderNo: string;
  /** 주문 상세 응답이 싣는다. undefined 는 이 값을 싣지 않는 옛 응답이다 */
  fulfillmentOrder: FulfillmentRef | null | undefined;
  /** 주문 상세 응답이 싣는다. undefined(옛 응답)면 출고주문이 생길 상품이 있는지 모른다 */
  lineRouteCounts?: LineRouteCounts;
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
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-gray-500">
            {lineRouteCounts?.warehouse === 0
              ? '창고에서 내보낼 상품이 없는 주문이에요.'
              : '아직 출고주문이 없어요.'}
          </p>
          {lineRouteCounts && <OffWarehouseNotes counts={lineRouteCounts} />}
        </div>
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
          <FulfillmentShipments fo={fulfillmentOrder} orderNo={orderNo} />
          {lineRouteCounts && <OffWarehouseNotes counts={lineRouteCounts} />}
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
