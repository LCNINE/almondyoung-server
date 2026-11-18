import type {
  DeliveryProfileSourceType,
  FulfillmentMode,
} from '@/lib/types/dto/inventory';

// 표와 다이얼로그가 함께 쓴다. 표 컴포넌트에 두면 표 → 다이얼로그 → 표 순환 import 가 되어
// 다이얼로그 모듈 최상위의 SOURCE_OPTIONS 계산이 초기화 전 접근(ReferenceError)으로 죽는다.
export const SOURCE_TYPE_LABELS: Record<DeliveryProfileSourceType, string> = {
  in_house: '자사 창고',
  direct: '직배송',
  overseas: '해외',
};

export const FULFILLMENT_MODE_LABELS: Record<FulfillmentMode, string> = {
  in_house: '자사 출고',
  '3pl': '3PL',
};

// 송장은 서버 설정의 우리 한진 계약 하나로만 발급한다. 계약을 늘리려면 송장 발급도 프로필 값을 따라가게 바꿔야 한다
export const CARRIER_CONTRACT_OPTIONS = [
  { value: 'HANJIN', label: '한진택배 · 우리 계약' },
];

export function carrierContractLabel(ref: string): string {
  return CARRIER_CONTRACT_OPTIONS.find((o) => o.value === ref)?.label ?? ref;
}
