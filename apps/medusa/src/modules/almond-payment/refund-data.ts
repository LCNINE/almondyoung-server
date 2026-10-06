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
