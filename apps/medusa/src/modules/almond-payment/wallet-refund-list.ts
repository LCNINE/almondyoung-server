/**
 * wallet 환불 목록 `GET /v1/payment-intents/:id/refunds`(#1048 — 상태 무관, 만든 순서, 맨 배열). 정산 직전 장부 맞추기(§6.2)가 읽는다.
 * provider 밖에서 부르므로 provider 옵션과 같은 출처(env, medusa-config.js 의 기본값)를 쓴다.
 * 실패는 던진다 — 장부를 못 맞췄으면 환불하지 않는다(이중 환불보다 지연이 낫다, 정산은 500 으로 다시 불린다).
 */
export type WalletRefundListItem = {
  id: string;
  status: string;
  amount: number;
  reasonCode: string | null;
  /** 자동(PG) 또는 수동(송금 대기). PENDING 행이 «진행 중»인지 «송금 대기»인지 가른다(D8) */
  execution: 'AUTO' | 'MANUAL';
  createdAt: string;
};

/**
 * 목록 조회는 결제 잠금(30초, paymentRefundLockKey) 안에서 돈다. 레디스 잠금은 timeout 이 곧 만료라, 걸린 호출이 잠금보다
 * 오래 가면 다른 정산이 들어온다 — 잠금보다 넉넉히 짧게 끊는다. 끊김은 일반 오류(일시)로 올라간다.
 */
const WALLET_REFUND_LIST_TIMEOUT_MS = 10_000;

export async function fetchWalletRefunds(intentId: string): Promise<WalletRefundListItem[]> {
  const base = process.env.WALLET_BASE_URL || 'http://localhost:3100';
  const key = process.env.WALLET_API_KEY || 'dev-secret';
  const res = await fetch(`${base}/v1/payment-intents/${encodeURIComponent(intentId)}/refunds`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(WALLET_REFUND_LIST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`wallet 환불 목록을 읽지 못했습니다 — 장부를 맞추지 못해 환불하지 않습니다(intentId=${intentId}, HTTP ${res.status})`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error(`wallet 환불 목록 응답이 배열이 아닙니다(intentId=${intentId})`);
  return body.map((row, index) => parseRow(row, intentId, index));
}

function parseRow(row: unknown, intentId: string, index: number): WalletRefundListItem {
  const r = (row ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.status !== 'string' || typeof r.amount !== 'number' || typeof r.createdAt !== 'string') {
    throw new Error(`wallet 환불 목록 ${index}번 행의 모양이 다릅니다(intentId=${intentId}): ${JSON.stringify(row)}`);
  }
  return {
    id: r.id,
    status: r.status,
    amount: r.amount,
    reasonCode: typeof r.reasonCode === 'string' ? r.reasonCode : null,
    // 없거나 모르는 값은 AUTO — PENDING 이면 «진행 중»으로 정산을 멈추는 쪽이다(넣으면 PG 가 실패해도 «환불 완료»가 된다)
    execution: r.execution === 'MANUAL' ? 'MANUAL' : 'AUTO',
    createdAt: r.createdAt,
  };
}
