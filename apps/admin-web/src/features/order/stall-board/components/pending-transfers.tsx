'use client';

import Link from 'next/link';
import { CanOpen } from '@/components/auth/can';
import { RefundConfirmCell } from '@/features/payments/components/refund-table/confirm-cell';
import { useReadGate } from '@/features/main/read-gate';
import { formatDwell } from '@/lib/api/domains/orders/order-progress.shape';
import {
  pendingTransfersOf,
  refundListHref,
} from '@/lib/api/domains/wallet/refund-execution';
import { refundKindLabel } from '@/lib/api/domains/wallet/refund-kind';
import { isServedInStage } from '@/lib/demo/capabilities';
import {
  PENDING_TRANSFER_LIMIT,
  usePendingRefunds,
} from '@/lib/services/wallet/queries';

export const PENDING_TRANSFER_READ = ['payment.refund.read'] as const;
/** 시연 단계는 wallet 을 섬기지 않는다 — 부르지도 그리지도 않는다 */
export const PENDING_TRANSFER_SERVED = isServedInStage(
  '/api/proxy/wallet',
  process.env.NEXT_PUBLIC_APP_STAGE
);

/**
 * 취소는 끝났고 고객 계좌로 송금해야 하는 환불 — 정산이 끝나면 주문은 이 단계에서 빠지지만 송금은 남는다.
 * [완료 처리]를 누르면 목록이 다시 읽혀 여기서 빠진다.
 */
export function PendingTransfers(props: { now: Date }) {
  const gate = useReadGate(PENDING_TRANSFER_READ);
  const q = usePendingRefunds({
    enabled: gate.enabled && PENDING_TRANSFER_SERVED,
  });

  if (!PENDING_TRANSFER_SERVED || gate.pending) return null;
  if (gate.failed || gate.hiddenReason) {
    return (
      <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        송금 대기 환불 ·{' '}
        {gate.hiddenReason ?? '권한을 확인하지 못해 보이지 못했습니다.'}
      </p>
    );
  }
  if (q.isPending) {
    return (
      <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        송금 대기 환불을 확인하는 중…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="border-b px-4 py-2.5 text-xs text-red-600">
        송금 대기 환불을 불러오지 못했습니다.{' '}
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
  const rows = pendingTransfersOf(q.data.data);
  const more = q.data.total > PENDING_TRANSFER_LIMIT;
  if (rows.length === 0 && !more) return null;

  return (
    <div className="border-b bg-amber-50/60 px-4 py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-amber-800">
          송금 대기 환불 {rows.length.toLocaleString('ko-KR')}건
        </h3>
        <span className="text-xs text-amber-800/80">
          취소는 끝났고 고객 계좌로 송금해야 합니다. 송금한 뒤 [완료 처리]를
          누르면 여기서 빠집니다.
        </span>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-amber-200/70 text-[13px]">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
            >
              <span className="font-semibold tabular-nums">
                {r.amount.toLocaleString('ko-KR')}원
              </span>
              <span className="text-muted-foreground">
                {refundKindLabel(r.kind)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatDwell(
                  props.now.getTime() - new Date(r.createdAt).getTime()
                )}{' '}
                전 접수
              </span>
              <span className="ml-auto flex items-center gap-2">
                <CanOpen screen="/payments">
                  <Link
                    href={`/payments/${encodeURIComponent(r.intentId)}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    결제 보기
                  </Link>
                </CanOpen>
                <CanOpen screen="/payments/refunds">
                  <Link
                    href={refundListHref(r.intentId)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    환불 내역
                  </Link>
                </CanOpen>
                <RefundConfirmCell refund={r} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <CanOpen screen="/payments/refunds">
          <Link
            href="/payments/refunds?status=PENDING"
            className="mt-1 inline-block text-xs text-blue-600 hover:underline"
          >
            대기 환불이 더 있습니다 — 환불 내역에서 모두 보기
          </Link>
        </CanOpen>
      )}
    </div>
  );
}
