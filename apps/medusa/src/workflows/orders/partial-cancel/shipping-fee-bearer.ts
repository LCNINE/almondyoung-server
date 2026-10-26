/**
 * 부분취소로 무료배송 기준이 깨질 때 그 택배비를 누가 내는가 — 취소 «사유»가 정한다(K8 N1).
 * customer 면 지금처럼 환불에서 뺀다. seller 면 매기지 않는다(품절·지연처럼 판매자 탓인 취소에 고객이 배송비를 물면 안 된다).
 * core 의 CancelChannelOrder 명령이 싣는 reasonCode·requestedBy 를 그대로 받는다. 몰라도 안전한 쪽은 seller 다 — 사유 없이 온 요청은 고객에게 비용을 물리지 않는다.
 */
export type ShippingFeeBearer = 'customer' | 'seller';

export function cancelShippingFeeBearer(input: { reasonCode?: string; requestedBy?: string }): ShippingFeeBearer {
  const { reasonCode, requestedBy } = input;
  // 고객이 직접 한 취소: 사유가 판매자 탓(DELAY)일 때만 판매자 몫. 사유 없음은 고객 변심으로 본다
  if (requestedBy === 'customer') return reasonCode === 'DELAY' ? 'seller' : 'customer';
  // 운영자가 고객 요청을 받아 한 취소만 고객 몫. 나머지(품절·관리자 사유·환불 승인 등)와 사유 없음은 판매자
  if (requestedBy === 'operator' && reasonCode === 'CUSTOMER_REQUEST') return 'customer';
  return 'seller';
}
