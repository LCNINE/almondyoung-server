'use client';

import Link from 'next/link';
import { useCan, useCanOpen } from '@/hooks/use-permission';
import { useCarrierTrackingSummary } from '@/lib/services/orders/carrier-tracking';
import { CARRIER_ATTENTION_HREF } from './carrier-tracking-copy';

/** 출고 준비 맨 위 한 줄. 확인할 송장이 없으면 그리지 않는다. */
export function CarrierAttentionLine() {
  const read = useCan(['fulfillment.order.read']);
  const board = useCanOpen('/order/stall-board');
  const q = useCarrierTrackingSummary(read.status === 'ready' && read.allowed);

  const failed = q.isError && (
    <span className="text-destructive">
      택배사 확인이 필요한 송장이 있는지 불러오지 못했어요.{' '}
      <button
        type="button"
        className="font-medium underline"
        onClick={() => void q.refetch()}
      >
        다시 확인
      </button>
    </span>
  );
  if (!q.data)
    return failed ? <p className="mx-4 mt-4 text-sm">{failed}</p> : null;
  const { attention, polling } = q.data;
  if (attention === 0 && !polling.failing) {
    // 앞서 0장이었어도 지금 못 읽었으면 «없음»이 아니다
    return failed ? <p className="mx-4 mt-4 text-sm">{failed}</p> : null;
  }

  const text =
    attention > 0
      ? `출고했지만 택배사 확인이 필요한 송장 ${attention.toLocaleString('ko-KR')}장${
          polling.failing ? ' · 지금 택배사 자동 조회가 안 되고 있어요' : ''
        }`
      : '택배사 자동 조회가 안 되고 있어요';
  return (
    <p className="mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
      <span className="break-keep">{text}</span>
      {board.status === 'ready' && board.allowed && (
        <Link
          href={CARRIER_ATTENTION_HREF}
          className="whitespace-nowrap underline underline-offset-2"
        >
          확인하러 가기
        </Link>
      )}
      {failed}
    </p>
  );
}
