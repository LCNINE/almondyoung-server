import type { ShipmentShortPickOperation } from '@/lib/types/dto/fulfillment';

/** 새 서버(PR 4)는 결품 보고를 한 번에 끝내고 결과(outcome)를 준다 — 그러면 보존·폴링할 대기가 아니다. */
export function isShortPickSettled(
  result: ShipmentShortPickOperation
): boolean {
  return result.outcome !== undefined;
}

export function shortPickOutcomeMessage(
  result: ShipmentShortPickOperation
): { tone: 'success' | 'info'; text: string } | null {
  if (result.outcome === 'refilled') {
    const where = (result.refills ?? [])
      .map((refill) => `[${refill.locationCode}] ${refill.qty}개`)
      .join(', ');
    return {
      tone: 'success',
      text: `다른 로케이션에서 채웠어요: ${where}. 새 송장을 출력해야 작업을 이어갈 수 있어요.`,
    };
  }
  if (result.outcome === 'withdrawing') {
    return {
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 빼는 중이에요. 현장에서 송장을 스캔해 집은 상품을 되돌림 바구니로 빼면 박스가 초안으로 돌아가요.',
    };
  }
  if (result.outcome === 'exited') {
    return {
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 뺐어요. 박스는 초안으로 돌아갔고 송장은 무효가 됐어요.',
    };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/**
 * 결품 수량이 «아직 집지 않은 몫» 을 넘으면 서버가 409 `SHORT_PICK_EXCEEDS_UNPICKED` 와 `errors[].unpickedQty` 를 준다.
 * 일반 충돌 문구(«다른 작업으로 상태가 변경…»)로는 작업자가 뭘 고쳐야 하는지 모른다. 해당 코드가 아니면 null.
 */
export function shortPickRejectionMessage(error: unknown): string | null {
  const response = asRecord(asRecord(error)?.response);
  const body = asRecord(response?.data) ?? response;
  if (
    body?.code !== 'SHORT_PICK_EXCEEDS_UNPICKED' ||
    !Array.isArray(body.errors) ||
    body.errors.length === 0
  )
    return null;
  const quantities = body.errors.map((entry) => {
    const qty = asRecord(entry)?.unpickedQty;
    return typeof qty === 'number' ? qty : null;
  });
  if (quantities.some((qty) => qty === null)) return null;
  if (quantities.length === 1) {
    return `이 로케이션에서 아직 집지 않은 수량은 ${quantities[0]}개예요. 이미 집은 상품은 결품이 아니에요.`;
  }
  return `집지 않은 수량이 모자란 곳이 ${quantities.length}곳이에요(각각 ${quantities.map((qty) => `${qty}개`).join(', ')}). 이미 집은 상품은 결품이 아니에요.`;
}
