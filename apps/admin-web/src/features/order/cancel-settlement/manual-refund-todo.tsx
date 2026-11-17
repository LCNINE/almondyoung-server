'use client';

import Link from 'next/link';
import { CanOpen } from '@/components/auth/can';
import {
  manualRefundTodo,
  type SettlementView,
} from '@/lib/api/domains/orders/cancel-request.shape';
import { refundListHref } from '@/lib/api/domains/wallet/refund-execution';
import { isServedInStage } from '@/lib/demo/capabilities';

const REFUNDS_SERVED = isServedInStage(
  '/payments/refunds',
  process.env.NEXT_PUBLIC_APP_STAGE
);

/** 계좌 송금으로 바꾼 정산 행의 남은 할 일과 그 결제의 환불 내역 링크 — 정체 보드 행과 주문 내역 취소 칸이 같이 쓴다 */
export function ManualRefundTodo(props: {
  settlement: SettlementView;
  walletIntentId: string | null | undefined;
  length?: 'full' | 'short';
}) {
  const todo = manualRefundTodo(props.settlement, props.length);
  if (!todo) return null;
  const intentId = REFUNDS_SERVED ? props.walletIntentId : null;
  return (
    <span className="block whitespace-normal text-xs leading-snug text-amber-700">
      {todo}
      {intentId && (
        <CanOpen screen="/payments/refunds">
          {' '}
          <Link
            href={refundListHref(intentId)}
            className="whitespace-nowrap font-medium text-blue-600 underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            환불 내역 보기
          </Link>
        </CanOpen>
      )}
    </span>
  );
}
