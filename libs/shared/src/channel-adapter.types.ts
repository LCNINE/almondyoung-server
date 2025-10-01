/**
 * Channel Adapter 공통 타입 정의
 * 
 * 이 파일은 channel-adapter 앱과 다른 서비스들이 공유하는 타입들을 정의합니다.
 */

export type ChannelType = 'naver_smartstore' | 'coupang' | 'medusa';

export type ClaimType = 'CANCEL' | 'RETURN' | 'EXCHANGE';

export interface ClaimInfo {
  claimId: string;
  claimType: ClaimType;
  status?: string;
  reason?: string;
  quantity?: number;
  completedDate?: string;
}

export interface DispatchInfo {
  deliveryMethod: string;
  trackingNumber?: string;
  deliveryCompanyCode?: string;
  promiseDeliveryDate?: string; // (쿠팡) 약속 배송일
  dispatchedAt?: string;
}

export interface BuyerInfo {
  name?: string;
  contact?: string;
  address?: {
    postalCode?: string;
    roadAddress?: string;
    detailAddress?: string;
  };
}

/**
 * 내부 주문 이벤트 데이터 형식
 * 
 * 채널에서 수신한 주문 정보를 표준화한 내부 포맷
 */
export interface InternalOrderEvent {
  channelType: ChannelType;
  externalOrderId: string; // 주문번호
  externalProductOrderId?: string; // 상품주문 단위 (네이버 productOrderId 등)
  status: string; // 주문 상태
  lastChangedType?: string; // (네이버) 상태 변경 타입
  lastChangedAt?: string; // 상태 변경 시각
  paymentDate?: string; // 결제 일시
  quantity: number; // 주문 수량
  remainQuantity?: number; // 클레임 후 남은 수량
  priceAmount: number; // 총 상품 가격
  discountAmount?: number; // 할인액
  buyer?: BuyerInfo; // 구매자/수취인 정보
  dispatch?: DispatchInfo; // 배송/발송 정보
  currentClaim?: ClaimInfo; // 진행 중인 클레임
  completedClaims?: ClaimInfo[]; // 완료된 클레임들
  createdAt?: string; // 외부 기준 생성시각
  updatedAt?: string; // 외부 기준 업데이트시각

  // WMS 연동을 위한 추가 속성들
  reason?: string; // 취소/교환/환불 사유
  claimInfo?: ClaimInfo; // 교환/환불 정보 (currentClaim과 동일하지만 명시적)
  productName?: string; // 상품명 (WMS 전달용)
}

/**
 * 내부 상품 데이터 형식
 */
export interface InternalProductData {
  id: string;
  name: string;
  price: number;
  description: string;
  categoryId?: string;
  brand?: string;
  options?: Array<{
    name: string;
    value: string;
    additionalPrice?: number;
  }>;
}

/**
 * 내부 재고 데이터 형식
 */
export interface InternalInventoryData {
  productId: string; // 네이버의 originProductNo 또는 내부 상품 ID
  stockQuantity: number;
  isOptionProduct: boolean; // 옵션 상품 여부
  reservedQuantity?: number;
  availableQuantity?: number;
  warehouseId?: string;
  // 옵션 상품인 경우 필요한 추가 정보
  optionInfo?: {
    optionCombinations?: Array<{
      id: number;
      stockQuantity: number;
      price?: number;
      usable?: boolean;
    }>;
    optionStandards?: Array<{
      id: number;
      stockQuantity: number;
      usable?: boolean;
    }>;
  };
}

