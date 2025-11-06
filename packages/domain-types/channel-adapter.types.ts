/**
 * Channel Adapter 공통 타입 정의
 *
 * 이 파일은 channel-adapter 앱과 다른 서비스들이 공유하는 타입들을 정의합니다.
 *
 * @deprecated 채널 어댑터 관련 이벤트 타입들은 @packages/event-contracts/streams/adapter.stream으로 이동되었습니다.
 * ChannelType, ClaimType, ClaimInfo, DispatchInfo, BuyerInfo, InternalOrderEvent는 event-contracts에서 직접 import하세요.
 */

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

