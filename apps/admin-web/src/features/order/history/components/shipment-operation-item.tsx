'use client';

import Link from 'next/link';
import dayjs from 'dayjs';
import { operationReasonText } from '@/features/order/fulfillments/detail/operation-reason-text';
import { requestChannelLabel } from '@/features/order/fulfillments/detail/operation-reasons';
import { operationStatusLabel } from '@/features/order/fulfillments/detail/shipment-action-copy';
import { operationTypeLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';
import type { SalesOrderShipmentOperationDto } from '@/lib/types/dto/orders';

/** 주문 이력 창의 상자 작업 줄 — 연결 기록 줄과 같은 모양 */
export function ShipmentOperationItem({
  item,
  operatorName,
}: {
  item: SalesOrderShipmentOperationDto;
  operatorName: string;
}) {
  const reason = operationReasonText(item.type, item.reasonCode, item.reason);
  const meta = [requestChannelLabel(item.requestChannel), operatorName]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex gap-3 border-b py-2.5 last:border-0">
      <div className="flex w-8 shrink-0 items-start justify-center pt-0.5 text-base">
        📦
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {operationTypeLabel(item.type)}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {operationStatusLabel(item.status)}
            </span>
            {item.otherOrdersInBox && (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                합포장 상자
              </span>
            )}
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {dayjs(item.createdAt).format('MM/DD HH:mm')}
          </span>
        </div>
        {(reason || meta) && (
          <p className="mt-1 break-words text-xs text-gray-600">
            {[reason, meta].filter(Boolean).join(' · ')}
          </p>
        )}
        {item.note && (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.note}
          </p>
        )}
        {item.shipmentIds.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {item.shipmentIds.map((id) =>
              item.fulfillmentOrderId ? (
                <Link
                  key={id}
                  href={`/order/fulfillments/${item.fulfillmentOrderId}?shipmentId=${id}`}
                  className="font-mono text-primary underline"
                >
                  상자 {id.slice(0, 8)}
                </Link>
              ) : (
                <span key={id} className="font-mono text-muted-foreground">
                  상자 {id.slice(0, 8)}
                </span>
              )
            )}
          </p>
        )}
      </div>
    </div>
  );
}
