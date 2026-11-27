import { servedTenantHeaders } from '../../../utils/served-tenant-headers';

const TIMEOUT_MS = 5000;

/**
 * Core 에 고객이 아직 직접 취소할 수 있는(출고 전·결제 완료) 주문을 묻는다.
 * 어떤 실패든 빈 목록이다 — 모르는 채로 배송비를 면제하지 않는다.
 */
export async function fetchCoreSelfCancelable(customerId: string, channelOrderIds: string[]): Promise<string[]> {
  if (channelOrderIds.length === 0) return [];

  const baseUrl = process.env.CORE_SERVICE_URL;
  const key = process.env.CORE_INTERNAL_KEY;
  if (!baseUrl || !key) {
    console.warn('[add-to-delivery] CORE_SERVICE_URL / CORE_INTERNAL_KEY 가 없어 부모 후보를 비운다');

    return [];
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/internal/sales-orders/self-cancelable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...servedTenantHeaders() },
      body: JSON.stringify({ customerId, channelOrderIds }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`core 응답 ${res.status}`);

    const body = (await res.json()) as { channelOrderIds?: unknown };
    const ids = body?.channelOrderIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error('core 응답 모양 불일치');

    const asked = new Set(channelOrderIds);

    return (ids as string[]).filter((id) => asked.has(id));
  } catch (e) {
    console.warn(
      `[add-to-delivery] Core 판정 실패로 부모 후보를 비운다: ${e instanceof Error ? e.message : String(e)}`,
    );

    return [];
  }
}
