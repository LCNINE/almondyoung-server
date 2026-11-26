'use client';

import { useState } from 'react';
import { useCan } from '@/hooks/use-permission';
import type { DirectDeliveryAwaitingItem } from '@/lib/api/domains/orders/direct-delivery.client';
import { useDirectDeliveryAwaiting } from '@/lib/services/orders/direct-delivery';
import { DirectDeliveryButton } from './direct-delivery-button';
import { awaitingAgeText, awaitingItemsText } from './direct-delivery-copy';

/** 공급처에 맡겼지만 송장을 아직 못 받은 상자 — 출고 준비 목록에서는 빠지므로 여기서 잊지 않게 한다. */
export function DirectDeliveryAwaitingLine({
  warehouseId,
}: {
  warehouseId: string;
}) {
  const read = useCan(['fulfillment.order.read']);
  const q = useDirectDeliveryAwaiting(
    read.status === 'ready' && read.allowed ? warehouseId : null
  );
  const [open, setOpen] = useState(false);

  if (q.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        공급처 직배송 송장을 기다리는 상자를 불러오지 못했어요.{' '}
        <button
          type="button"
          className="font-medium underline"
          onClick={() => void q.refetch()}
        >
          다시 확인
        </button>
      </p>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label="직배송 송장 기다림"
      className="space-y-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-sky-950 break-keep">
          직배송 송장 기다림 {items.length.toLocaleString('ko-KR')}장 —
          공급처에게 송장을 받으면 넣어 주세요
        </span>
        <button
          type="button"
          className="whitespace-nowrap font-medium underline underline-offset-2"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <ul role="list" className="divide-y divide-sky-100">
          {items.map((item) => (
            <AwaitingRow key={item.shipmentId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AwaitingRow({ item }: { item: DirectDeliveryAwaitingItem }) {
  const orderText = item.orderNo ? `#${item.orderNo}` : '주문번호 없는 상자';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0 space-y-0.5 break-keep">
        <p className="font-medium">
          {orderText} · {awaitingItemsText(item)}
        </p>
        <p className="text-muted-foreground">
          {item.supplierName} · {awaitingAgeText(item.handedOffAt, new Date())}
        </p>
      </div>
      <DirectDeliveryButton
        shipmentId={item.shipmentId}
        orderText={orderText}
        label="송장 넣기·되돌리기"
      />
    </li>
  );
}
