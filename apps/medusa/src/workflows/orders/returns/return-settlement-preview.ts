import type { MedusaContainer } from '@medusajs/framework/types';

import { listOrderRefunds } from '../settlement/order-payments';
import type { ReturnSettlementDeduction } from './plan-return-fees';
import { assertPrepayableReturn, estimateReturnPrepay } from './prepay-order-return';
import { ReturnOrderNotFound } from './request-order-return';
import { prepaidTotal, readReturnPrepayRecord } from './return-prepay-record';
import { loadReturnSettlementRecords } from './return-settlement-record';
import { loadOrder, loadReturn } from './settle-order-return';

export type ReturnSettlementPreview = {
  /** 반품 품목 값 V — 선환불 상한 */
  itemValue: number;
  /** 택배비 예상 F */
  feeEstimate: ReturnSettlementDeduction;
  /** 금액 없이 선환불하면 낼 값(V − F) */
  defaultPrepayAmount: number;
  /** 이 반품의 선환불 메모(return-prepay:<requestId>) 환불 합 — 장부가 정본이다(N6) */
  prepaidAmount: number;
};

/**
 * 반품 정산 미리보기(K8 PR6b N9) — 선환불 기본값과 보류 차감의 여지를 화면이 보여 줄 숫자. 쓰기 없음, 잠금 없음.
 * 선환불과 같은 판정(열리는 반품만)과 같은 계산(estimateReturnPrepay)을 쓴다 — 미리보기와 실제 금액이 갈리지 않게.
 */
export async function returnSettlementPreview(
  container: MedusaContainer,
  input: { orderId: string; returnId: string },
): Promise<ReturnSettlementPreview> {
  const ret = await loadReturn(container, input.returnId);
  // 다른 주문의 반품 id 는 «없는 반품» — 존재 여부를 가르지 않는다
  if (!ret || ret.orderId !== input.orderId) throw new ReturnOrderNotFound(`반품을 찾을 수 없습니다: ${input.returnId}`);
  const request = assertPrepayableReturn(ret);
  const order = await loadOrder(container, input.orderId);
  const settlements = await loadReturnSettlementRecords(container, input.orderId);
  const estimate = await estimateReturnPrepay(container, { order, ret, feeBearer: request.feeBearer, settlements });
  // 선환불 기록은 환불 «전»에 쓰이므로, 기록이 없으면 이 반품의 선환불 환불도 없다
  const prepay = readReturnPrepayRecord(ret.metadata);
  const prepaidAmount = prepay ? prepaidTotal(await listOrderRefunds(container, input.orderId), prepay.requestId) : 0;
  return { ...estimate, prepaidAmount };
}
