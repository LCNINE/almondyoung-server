'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CanOpen } from '@/components/auth/can';
import { useCan } from '@/hooks/use-permission';
import type { CarrierTrackingItem } from '@/lib/api/domains/orders/carrier-tracking.client';
import { useCarrierTrackingAttention } from '@/lib/services/orders/carrier-tracking';
import { carrierLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';
import { useOperatorNames } from '@/features/order/fulfillments/detail/operation-operator';
import { CarrierConfirmDialog } from './carrier-confirm-dialog';
import { CarrierTrackingActions } from './carrier-tracking-actions';
import {
  ATTENTION_TITLE,
  attentionText,
  groupByKind,
  confirmationText,
  lastCheckText,
  nextStepText,
  pollingText,
} from './carrier-tracking-copy';

type ActorName = (id: string | null | undefined) => string;

/** 정체 보드 추적 — 우리는 출고했는데 택배사 쪽이 어긋난 송장 */
export function CarrierAttentionPanel({ now }: { now: Date }) {
  const q = useCarrierTrackingAttention();
  const items = q.data?.items ?? [];
  const actorName = useOperatorNames(
    items.flatMap((item) => item.confirmations.map((row) => row.actorId))
  );
  // 적는 사이 목록에서 빠지거나 자리가 바뀌어도 창은 남는다
  const [confirming, setConfirming] = useState<CarrierTrackingItem | null>(
    null
  );

  return (
    <>
      <AttentionBody
        q={q}
        now={now}
        actorName={actorName}
        onConfirm={setConfirming}
      />
      {confirming && (
        <CarrierConfirmDialog
          opened={confirming}
          latest={items.find(
            (item) => item.dispatchAttemptId === confirming.dispatchAttemptId
          )}
          now={now}
          actorName={actorName}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}

function AttentionBody({
  q,
  now,
  actorName,
  onConfirm,
}: {
  q: ReturnType<typeof useCarrierTrackingAttention>;
  now: Date;
  actorName: ActorName;
  onConfirm: (item: CarrierTrackingItem) => void;
}) {
  const recall = useCan(['fulfillment.dispatch.recall']);
  const canRecall = recall.status === 'ready' && recall.allowed;

  if (q.isPending) {
    return (
      <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        택배사 확인이 필요한 송장을 찾는 중…
      </p>
    );
  }
  if (!q.data) {
    return (
      <p className="border-b px-4 py-2.5 text-xs text-red-600">
        택배사 확인이 필요한 송장을 불러오지 못했어요.{' '}
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
  const { attention, waiting, items, polling } = q.data;
  const pollingNotice = pollingText(polling, now);
  if (attention === 0 && waiting === 0 && !pollingNotice && !q.isError) {
    return null;
  }
  const raised = items.filter((item) => item.raised);
  const parked = items.filter((item) => !item.raised);
  const hidden = attention + waiting - items.length;

  return (
    <div className="space-y-2 border-b bg-amber-50/60 px-4 py-3">
      {q.isError && (
        <p role="alert" className="text-xs font-medium text-red-600">
          다시 불러오지 못해 조금 전 내용을 보이고 있어요.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void q.refetch()}
          >
            다시 확인
          </button>
        </p>
      )}
      {pollingNotice && (
        <p role="alert" className="break-keep text-xs font-medium text-red-600">
          {pollingNotice}
        </p>
      )}
      {attention > 0 && (
        <>
          <h3 className="text-sm font-semibold text-amber-800">
            택배사 확인이 필요한 송장 {attention.toLocaleString('ko-KR')}장
          </h3>
          <ItemList
            label="택배사 확인이 필요한 송장"
            items={raised}
            now={now}
            canRecall={canRecall}
            actorName={actorName}
            onConfirm={onConfirm}
          />
        </>
      )}
      {waiting > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-amber-800">
            확인하고 기다리는 송장 {waiting.toLocaleString('ko-KR')}장
          </summary>
          <ItemList
            label="확인하고 기다리는 송장"
            items={parked}
            now={now}
            canRecall={canRecall}
            actorName={actorName}
            onConfirm={onConfirm}
          />
        </details>
      )}
      {hidden > 0 && (
        <p className="text-xs text-amber-800">
          그 밖에 {hidden.toLocaleString('ko-KR')}장이 더 있어요. 위에서부터
          처리하면 이어서 나와요.
        </p>
      )}
    </div>
  );
}

function ItemList({
  label,
  items,
  now,
  canRecall,
  actorName,
  onConfirm,
}: {
  label: string;
  items: CarrierTrackingItem[];
  now: Date;
  canRecall: boolean;
  actorName: ActorName;
  onConfirm: (item: CarrierTrackingItem) => void;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-3 pt-1">
      {groupByKind(items).map((group) => (
        <section key={group.kind} className="space-y-1">
          <h4 className="text-[13px] font-semibold text-red-700">
            {ATTENTION_TITLE[group.kind]} {group.items.length}장
          </h4>
          <p className="break-keep text-xs">
            {nextStepText(group.kind, canRecall)}
          </p>
          <ul
            role="list"
            aria-label={ATTENTION_TITLE[group.kind]}
            className="divide-y divide-amber-200/70 text-[13px]"
          >
            {group.items.map((item) => (
              <li key={item.dispatchAttemptId} className="space-y-0.5 py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {carrierLabel(item.carrier)} {item.trackingNo}
                  </span>
                  {item.orders.map((order) => (
                    <CanOpen
                      key={order.salesOrderId}
                      screen="/order/history"
                      fallback={<span>#{order.orderNo}</span>}
                    >
                      <Link
                        href={`/order/history?orderNo=${encodeURIComponent(order.channelOrderId)}`}
                        className="whitespace-nowrap text-primary underline underline-offset-2"
                      >
                        #{order.orderNo}
                      </Link>
                    </CanOpen>
                  ))}
                  <Link
                    href={`/order/fulfillments?shipmentId=${encodeURIComponent(item.shipmentId)}`}
                    className="whitespace-nowrap text-primary underline underline-offset-2"
                  >
                    상자 상세
                  </Link>
                  <CarrierTrackingActions item={item} onConfirm={onConfirm} />
                </div>
                <p className="break-keep text-xs">
                  {attentionText(item, now)}
                  <span className="text-muted-foreground">
                    {' '}
                    · {lastCheckText(item, now)}
                  </span>
                </p>
                {item.confirmations[0] && (
                  <p className="break-words text-xs text-amber-800">
                    앞선 확인:{' '}
                    {confirmationText(
                      item.confirmations[0],
                      actorName(item.confirmations[0].actorId)
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
