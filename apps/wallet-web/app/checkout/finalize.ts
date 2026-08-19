'use server';

import { medusa } from '@/lib/medusa';
import { getMedusaAuthHeaders } from '@/lib/medusa';

export type FinalizeResult =
  | { type: 'order'; orderId?: string }
  | { type: 'awaiting_deposit' }
  | { type: 'error'; message: string };

/**
 * 결제 승인 직후 주문 확정.
 *
 * Medusa 의 `/store/payment-intents/{id}/complete` 를 그대로 쓴다. 이 라우트가 이미
 * intent → payment_session → payment_collection → cart 를 역추적하고, 기존 주문이 있으면
 * 그대로 돌려주며(멱등), 무통장 미입금이면 409 로 막고, 성공 시 capture 까지 한다.
 * 여기서 다시 구현할 것이 없다.
 */
export async function finalizeOrder(intentId: string): Promise<FinalizeResult> {
  try {
    const headers = { ...(await getMedusaAuthHeaders()) };
    const res = (await medusa.client.fetch(`/store/payment-intents/${intentId}/complete`, {
      method: 'POST',
      headers,
    })) as { type?: string; order?: { id?: string } };

    return { type: 'order', orderId: res?.order?.id };
  } catch (error) {
    // 무통장 미입금 주문은 완료시키면 안 된다 — 주문은 입금 확인 웹훅이 만든다.
    if (isAwaitingDepositError(error)) {
      return { type: 'awaiting_deposit' };
    }
    return {
      type: 'error',
      message: error instanceof Error ? error.message : '주문 생성에 실패했어요.',
    };
  }
}

function isAwaitingDepositError(error: unknown): boolean {
  const raw = JSON.stringify(error ?? '');
  return raw.includes('BANK_TRANSFER_AWAITING_DEPOSIT');
}
