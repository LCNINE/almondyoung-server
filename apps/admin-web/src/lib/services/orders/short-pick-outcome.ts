import type { ShipmentShortPickOperation } from '@/lib/types/dto/fulfillment';

/** 새 서버(PR 4)는 결품 보고를 한 번에 끝내고 결과(outcome)를 준다 — 그러면 보존·폴링할 대기가 아니다. */
export function isShortPickSettled(result: ShipmentShortPickOperation): boolean {
  return result.outcome !== undefined;
}

export function shortPickOutcomeMessage(
  result: ShipmentShortPickOperation,
): { tone: 'success' | 'info'; text: string } | null {
  if (result.outcome === 'refilled') {
    const where = (result.refills ?? []).map((refill) => `[${refill.locationCode}] ${refill.qty}개`).join(', ');
    return { tone: 'success', text: `다른 로케이션에서 채웠어요: ${where}. 송장을 다시 출력해야 작업을 이어갈 수 있어요.` };
  }
  if (result.outcome === 'withdrawing') {
    return {
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 빼는 중이에요. 현장에서 송장을 스캔해 집은 상품을 되돌림 바구니로 빼면 박스가 초안으로 돌아가요.',
    };
  }
  if (result.outcome === 'exited') {
    return { tone: 'info', text: '채울 재고가 없어 박스를 배치에서 뺐어요. 박스는 초안으로 돌아갔고 송장은 무효가 됐어요.' };
  }
  return null;
}
