/**
 * 배송비 그룹 = Medusa shipping profile 1개 + 그 profile 에 달린 calculated shipping option 1개.
 *
 * 그룹 정책은 shipping_option.data 에 통째로 저장된다. 어드민/스토어 API 와 provider 가 모두
 * 이 한 곳을 읽으므로 금액이 복제되는 지점이 없다.
 */

export type ShippingFeeType =
  /** 항상 0원 */
  | 'free'
  /** 구매 금액과 무관하게 baseFee */
  | 'flat'
  /** 그룹 소계가 freeThreshold 이상이면 0원, 아니면 baseFee */
  | 'conditional_free'
  /** baseFee × 그룹 상품 수량 */
  | 'per_quantity';

export type ShippingFeePolicy = {
  type: ShippingFeeType;
  /** type 이 'free' 면 무시된다. */
  baseFee: number;
  /** type 이 'conditional_free' 일 때만 의미가 있다. */
  freeThreshold?: number;
  /**
   * 지역 추가비는 지역별 배송비 템플릿에서 온다. 계산 시점에 템플릿을 조회할 수 없어
   * (provider 는 store 모듈에 접근할 수 없다) 그룹 저장 시점에 여기로 복사한다.
   * 템플릿을 고치면 그 템플릿을 쓰는 그룹들을 다시 저장해 갱신한다.
   */
  jejuExtraFee?: number;
  islandExtraFee?: number;
};

/** 배송 안내용 정보. 배송비 계산에는 영향이 없고 상품 상세에 그대로 표시된다. */
export type ShippingGroupDelivery = {
  /** 택배 / 화물배송 / 직접배송 등 */
  method: string;
  /** 전국지역 / 수도권 등 */
  area: string;
  leadTimeMinDays: number;
  leadTimeMaxDays: number;
  /** 택배사 이름 (한진택배 등). 비우면 스토어프론트가 기본 문구를 쓴다. */
  carrier?: string;
};

export type ShippingGroup = {
  code: string;
  name: string;
  policy: ShippingFeePolicy;
  /** 지역별 배송비 템플릿 코드. 없으면 지역 추가비 없음. */
  areaTemplateCode?: string;
  delivery: ShippingGroupDelivery;
  /** 고객 안내용 설명. 스토어프론트의 개별 배송비 안내 옆 (?) 툴팁에 그대로 표시된다. */
  description?: string;
};

/** shipping_option.data 에 저장되는 형태. provider 가 calculatePrice 의 optionData 로 받는다. */
export type ShippingGroupOptionData = {
  shippingGroupCode: string;
  shippingProfileId: string;
  policy: ShippingFeePolicy;
  areaTemplateCode?: string;
  delivery: ShippingGroupDelivery;
  description?: string;
};

/**
 * 지역별 배송비 템플릿. 여러 배송비 그룹이 같은 제주·도서산간 금액을 공유하도록 분리했다.
 * store.metadata 에 배열로 저장한다 — 행이 몇 개 안 되고 커스텀 모듈/마이그레이션을 하나
 * 더 만들 만한 규모가 아니다.
 */
export type ShippingAreaTemplate = {
  code: string;
  name: string;
  jejuExtraFee: number;
  islandExtraFee: number;
};

export const DEFAULT_SHIPPING_GROUP_CODE = 'default';
export const DEFAULT_AREA_TEMPLATE_CODE = 'default';
export const STORE_AREA_TEMPLATES_KEY = 'shippingAreaTemplates';

export const DEFAULT_SHIPPING_GROUP_DELIVERY: ShippingGroupDelivery = {
  method: '택배',
  area: '전국지역',
  leadTimeMinDays: 2,
  leadTimeMaxDays: 3,
};
