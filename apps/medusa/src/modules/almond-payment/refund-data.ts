/**
 * 결제 data 에 남기는 환불 표식 (ADR-0042 원칙 3).
 *
 * - walletRefundIds: almond-payment 가 wallet 에 낸 환불의 wallet id. 환불 사실이 돌아왔을 때 «우리가 낸 것»을 가린다.
 * - externalRefund: Medusa 밖에서 이미 끝난 wallet 환불을 장부에 넣는 중이라는 표식. 이게 있으면 refundPayment 는
 *   wallet 을 부르지 않는다 — 캡처 투영의 `captured: true` 와 같은 패턴.
 */
export type ExternalRefundMarker = { walletRefundId: string; amount: number };

export function readWalletRefundIds(data: Record<string, unknown> | null | undefined): string[] {
  const v = data?.walletRefundIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function withWalletRefundIds(data: Record<string, unknown>, ids: string[]): Record<string, unknown> {
  return { ...data, walletRefundIds: [...new Set([...readWalletRefundIds(data), ...ids])] };
}

export function readExternalRefund(data: Record<string, unknown> | null | undefined): ExternalRefundMarker | null {
  const v = data?.externalRefund as Partial<ExternalRefundMarker> | undefined;
  if (!v || typeof v.walletRefundId !== 'string' || typeof v.amount !== 'number') return null;
  return { walletRefundId: v.walletRefundId, amount: v.amount };
}

export function withExternalRefund(data: Record<string, unknown>, marker: ExternalRefundMarker): Record<string, unknown> {
  return { ...data, externalRefund: marker };
}

export function withoutExternalRefund(data: Record<string, unknown>): Record<string, unknown> {
  // 키를 빼는 게 아니라 null 로 쓴다 — Medusa 의 repository update 는 JSON 컬럼을 병합(mergeObjectProperties)해서
  // 빠진 키는 지워지지 않고 남는다. readExternalRefund 는 객체가 아니면 없는 것으로 본다.
  return { ...data, externalRefund: null };
}

/** wallet `POST /v1/payment-intents/:id/refund` 응답의 환불 행(RefundResponseDto)에서 판정에 쓰는 필드. */
export type WalletRefundRow = {
  id?: string;
  status?: string;
  amount?: number;
  reasonCode?: string | null;
  reasonMessage?: string | null;
};
export type WalletRefundVerdict =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      reason: string;
      /** 실패 판정이어도 wallet 에서 실제로 나간(또는 나가는 중인) 환불 — 장부에 안 남으니 로그가 유일한 흔적이다. */
      moved: Array<{ id: string; amount: number; status: string }>;
    };

/**
 * wallet 환불 응답이 «요청한 금액이 실제로 나갔다»인지 판정한다.
 *
 * wallet 은 PG 거절·예외를 FAILED 행으로 바꿔 200 에 담아 돌려준다(RefundsService.create). HTTP 200 만 보면
 * Medusa 가 환불·크레딧 라인을 기록하는데 돈은 안 나간다. FAILED 행이 하나라도 있거나, 성공+대기 합이 요청보다
 * 적으면 실패다. PENDING(무통장 환불 송금 대기)은 성공으로 센다 — 송금은 wallet 이 이어서 추적하고, 이미 잡힌
 * 금액이라 다시 환불하면 같은 돈을 두 번 돌려준다.
 */
export function judgeWalletRefund(rows: WalletRefundRow[], requested: number): WalletRefundVerdict {
  const moved = rows
    .filter((r) => r.status === 'SUCCEEDED' || r.status === 'PENDING')
    .map((r) => ({ id: typeof r.id === 'string' ? r.id : '?', amount: Number(r.amount ?? NaN), status: r.status as string }));
  const failed = rows.find((r) => r.status === 'FAILED');
  if (failed) {
    return {
      ok: false,
      reason: `wallet 환불 ${failed.id ?? '?'} 가 FAILED 입니다(reasonCode=${failed.reasonCode ?? '-'}, reasonMessage=${failed.reasonMessage ?? '-'})`,
      moved,
    };
  }
  const unknown = rows.find((r) => r.status !== 'SUCCEEDED' && r.status !== 'PENDING');
  if (unknown) {
    return { ok: false, reason: `wallet 환불 ${unknown.id ?? '?'} 의 상태를 알 수 없습니다: ${String(unknown.status)}`, moved };
  }
  const total = moved.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  if (total < requested) {
    return { ok: false, reason: `wallet 환불 합계 ${total} 가 요청 ${requested} 보다 적습니다`, moved };
  }
  return { ok: true, ids: moved.map((r) => r.id).filter((id) => id !== '?') };
}

/**
 * 한 결제의 환불 기록·표식 쓰기를 직렬화하는 잠금 키. 환불 투영(payment-events)과 환불을 내는 쪽이 같은 키를 쓴다 —
 * 서로 다른 Medusa 태스크에서 같은 환불 사실이 동시에 처리돼도 한 번만 기록되게 한다.
 *
 * 주의: Medusa 레디스 locking provider 는 `timeout` 을 대기 한도이자 잠금 만료로 같이 쓰고, 풀 때 owner "*" 로 푼다.
 * 이 잠금 안의 일(환불 워크플로 한 번)이 timeout 을 넘기면 잠금이 먼저 풀려 다른 태스크가 들어온다 — timeout 보다 넉넉히 짧게 둘 것.
 */
export const paymentRefundLockKey = (paymentId: string): string => `almond-payment-refund:${paymentId}`;
