'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useChangeRefundKind } from '@/lib/services/wallet';
import { REFUND_KINDS, refundKindLabel, type RefundKind } from '@/lib/api/domains/wallet/refund-kind';
import type { RefundDto } from '@/lib/types/dto/wallet';

const UNKNOWN = '';

/**
 * «종류» 칸 — 환불 목록·결제 상세 공용. 누르면 select 로 바뀌고, 고르면 바로 저장한다(#1016 40번).
 * 저장 뒤 캐시는 덮지 않고 다시 읽는다(응답의 manualConfirmable 이 항상 false 라서).
 */
export function RefundKindCell({ refund }: { refund: RefundDto }) {
  const [editing, setEditing] = useState(false);
  const change = useChangeRefundKind();

  if (!editing) {
    return (
      <button type="button" className="text-sm hover:underline" onClick={() => setEditing(true)}>
        {refundKindLabel(refund.kind)}
      </button>
    );
  }

  return (
    <select
      autoFocus
      className="rounded border p-1 text-sm"
      value={refund.kind ?? UNKNOWN}
      disabled={change.isPending}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const next = e.target.value === UNKNOWN ? null : (e.target.value as RefundKind);
        if (next === (refund.kind ?? null)) return setEditing(false);
        change.mutate(
          { refundId: refund.id, intentId: refund.intentId, kind: next },
          {
            onSuccess: () => setEditing(false),
            onError: (err) => toast.error(err instanceof Error && err.message ? err.message : '종류를 바꾸지 못했습니다.'),
          },
        );
      }}
    >
      <option value={UNKNOWN}>{refundKindLabel(null)}</option>
      {REFUND_KINDS.map((k) => (
        <option key={k} value={k}>
          {refundKindLabel(k)}
        </option>
      ))}
    </select>
  );
}
