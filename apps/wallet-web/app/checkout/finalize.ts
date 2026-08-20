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
  const authHeaders = await getMedusaAuthHeaders();
  // 비인증으로 부르면 Medusa 가 에러 없이 다른 권한 컨텍스트로 처리한다. 확정을 맡길 수 없다.
  if (!authHeaders) {
    return { type: 'error', message: '로그인이 만료되었어요. 다시 시도해주세요.' };
  }

  try {
    const res = (await medusa.client.fetch(`/store/payment-intents/${intentId}/complete`, {
      method: 'POST',
      headers: authHeaders,
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

const AWAITING_DEPOSIT_CODE = 'BANK_TRANSFER_AWAITING_DEPOSIT';

function isAwaitingDepositError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes(AWAITING_DEPOSIT_CODE)) return true;
  try {
    return JSON.stringify(error ?? '').includes(AWAITING_DEPOSIT_CODE);
  } catch {
    // 순환참조가 있는 에러 객체 — 직렬화가 던진다. 미입금 판정만 포기하고 일반 에러로 넘긴다.
    return false;
  }
}
