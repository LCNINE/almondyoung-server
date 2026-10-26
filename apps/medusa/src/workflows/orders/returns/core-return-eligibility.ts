export type CoreReturnEligibility = {
  found: boolean;
  lines: Array<{ channelOrderItemId: string; deliveredUnits: number; lastDeliveredAt: Date | null }>;
};

/** core 가 답을 못 줬다(설정 누락·네트워크·비정상 응답). 호출자는 «반품 불가»가 아니라 «지금은 판정 불가»로 다룬다. */
export class CoreEligibilityUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreEligibilityUnavailable';
  }
}

const TIMEOUT_MS = 5000;

/**
 * core 에 Medusa 주문의 줄별 «배송완료 판매 단위»와 «마지막 배송완료 시각»을 묻는다.
 * 반품으로 빠진 수량은 포함하지 않는다(청구 전 사실) — 그건 Medusa 가 자기 반품 기록으로 뺀다(N2).
 * 어떤 실패든 CoreEligibilityUnavailable 하나로 닫는다 — 모르는 채로 반품을 통과시키지 않기 위해서다.
 */
export async function fetchCoreReturnEligibility(orderId: string): Promise<CoreReturnEligibility> {
  const baseUrl = process.env.CORE_SERVICE_URL;
  const key = process.env.CORE_INTERNAL_KEY;
  if (!baseUrl || !key) throw new CoreEligibilityUnavailable('CORE_SERVICE_URL / CORE_INTERNAL_KEY 가 설정되지 않았습니다');

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/internal/sales-orders/return-eligibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ salesChannel: 'medusa', externalOrderId: orderId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new CoreEligibilityUnavailable(`core 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new CoreEligibilityUnavailable(`core 응답 ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CoreEligibilityUnavailable('core 응답이 JSON 이 아닙니다');
  }
  return parse(body);
}

function parse(body: unknown): CoreReturnEligibility {
  const bad = (why: string) => new CoreEligibilityUnavailable(`core 응답 모양 불일치: ${why}`);
  if (typeof body !== 'object' || body === null) throw bad('객체 아님');
  const { found, lines } = body as { found?: unknown; lines?: unknown };
  if (typeof found !== 'boolean') throw bad('found');
  if (!Array.isArray(lines)) throw bad('lines');

  return {
    found,
    lines: lines.map((raw: unknown) => {
      const line = (raw ?? {}) as Record<string, unknown>;
      const { channelOrderItemId, deliveredUnits, lastDeliveredAt } = line;
      if (typeof channelOrderItemId !== 'string') throw bad('channelOrderItemId');
      if (typeof deliveredUnits !== 'number' || !Number.isFinite(deliveredUnits)) throw bad('deliveredUnits');
      if (lastDeliveredAt === null || lastDeliveredAt === undefined) {
        return { channelOrderItemId, deliveredUnits, lastDeliveredAt: null };
      }
      const at = typeof lastDeliveredAt === 'string' ? new Date(lastDeliveredAt) : null;
      if (!at || Number.isNaN(at.getTime())) throw bad('lastDeliveredAt');
      return { channelOrderItemId, deliveredUnits, lastDeliveredAt: at };
    }),
  };
}
