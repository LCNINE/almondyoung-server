import { resolveKoreanShippingArea } from './korea-postal-area';
import type { ShippingFeePolicy } from './types';

export type ShippingFeeLine = {
  /** 할인 전 라인 금액. 무료배송 기준 판정에 쓴다. */
  subtotal: number;
  quantity: number;
};

/**
 * 한 배송비 그룹의 배송비를 계산한다.
 *
 * @param lines 그 그룹에 속한 카트 라인만. 카트 전체가 아니다 —
 *              그룹 소계로 무료 여부를 판정하는 것이 이 함수의 존재 이유다.
 *
 * 무료 기준 금액은 **할인 전** 소계와 비교한다. 할인 후로 잡으면 쿠폰으로 무료배송을
 * 만들어낼 수 있고, 카페24 도 "정상가 기준, 할인 전" 을 권장한다.
 *
 * 지역 추가비는 배송비가 0원으로 떨어져도 별도로 부과한다(한국 택배 관례).
 */
export function calculateShippingFee(
  policy: ShippingFeePolicy,
  lines: ShippingFeeLine[],
  postalCode?: string | null,
): number {
  if (lines.length === 0) return 0;

  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, line.subtotal), 0);
  const quantity = lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
  const baseFee = Math.max(0, policy.baseFee ?? 0);

  let fee: number;
  switch (policy.type) {
    case 'free':
      fee = 0;
      break;
    case 'flat':
      fee = baseFee;
      break;
    case 'conditional_free':
      fee = subtotal >= (policy.freeThreshold ?? 0) ? 0 : baseFee;
      break;
    case 'per_quantity':
      fee = baseFee * quantity;
      break;
    default:
      throw new Error(`Unknown shipping fee type: ${String(policy.type)}`);
  }

  return fee + resolveAreaExtraFee(policy, postalCode);
}

function resolveAreaExtraFee(policy: ShippingFeePolicy, postalCode?: string | null): number {
  const area = resolveKoreanShippingArea(postalCode);
  if (area === 'jeju') return Math.max(0, policy.jejuExtraFee ?? 0);
  if (area === 'island') return Math.max(0, policy.islandExtraFee ?? 0);
  return 0;
}
