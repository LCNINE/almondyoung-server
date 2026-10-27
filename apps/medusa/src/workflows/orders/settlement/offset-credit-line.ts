import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createOrderCreditLinesWorkflow } from '@medusajs/medusa/core-flows';

import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { loadOrderView } from './load-order-view';

/**
 * 상계한 몫을 음수 크레딧 라인으로 적는다 — 외부 환불이 남긴 «+X 금액 조정»을 «품목 값»으로 다시 분류한다.
 * 같은 reference·referenceId 라인이 이미 있으면 건너뛴다(환불 실패 뒤 재시도). 0 이하면 아무것도 하지 않는다.
 * 부분취소(reference 'partial-cancel', 요청 id)와 반품 정산(reference 'return-offset', 요청 id)이 쓴다.
 */
export async function offsetCreditLine(
  container: MedusaContainer,
  input: { orderId: string; reference: string; referenceId: string; amount: number },
): Promise<void> {
  const { orderId, reference, referenceId, amount } = input;
  if (amount <= 0) return;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orderModule = container.resolve(Modules.ORDER);
  const order = await orderModule.retrieveOrder(orderId, { select: ['id'], relations: ['credit_lines'] });
  const lines = order.credit_lines ?? [];
  const exists = lines.some((l) => l.reference === reference && l.reference_id === referenceId);
  if (exists) return;
  // 알려진 절단(부분취소 스펙 §8): Medusa 는 크레딧 라인 합이 0 이하면 0 으로 자른다 — 상계가 지금 합보다 크면 넘는 몫은
  // 차액을 움직이지 못해 차액이 음수로 남는다. 동작은 바꾸지 않고 보이게만 한다.
  const creditSum = lines.reduce((s, l) => s + toNumber(l.amount), 0);
  if (amount > creditSum) {
    logger.warn(
      `${reference} 상계가 크레딧 라인 합보다 큽니다 — Medusa 는 합이 0 이하인 크레딧을 0 으로 잘라 차액이 음수로 남습니다: ` +
        `orderId=${orderId} requestId=${referenceId} applied=${amount} creditSum=${creditSum}`,
    );
  }
  try {
    await createOrderCreditLinesWorkflow(container).run({
      input: { id: orderId, credit_lines: [{ amount: -amount, reference, reference_id: referenceId }] },
    });
  } catch (error) {
    // 부분취소 스펙 §8-4: 상계가 막히면 재시도마다 같은 자리에서 멈춘다 — 무엇을 넣으려다 어떤 차액에 막혔는지 남긴다
    const pending = await loadOrderView(container, orderId).then(
      (o) => (o ? String(o.pendingDifference) : 'unknown'),
      () => 'unknown',
    );
    logger.error(
      `${reference} 상계 크레딧 라인을 넣지 못했습니다: orderId=${orderId} requestId=${referenceId} applied=${amount} ` +
        `pendingDifference=${pending} — ${describeError(error)}`,
    );
    throw error;
  }
}
