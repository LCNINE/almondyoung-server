/**
 * Channel Adapter 공통 타입 정의
 *
 * 이 파일은 channel-adapter 앱과 다른 서비스들이 공유하는 타입들을 정의합니다.
 *
 * @deprecated 이 타입들은 @app/shared/streams/adapter.stream.ts로 이동되었습니다.
 * 하위 호환성을 위해 re-export만 수행합니다.
 */

export type {
  ChannelType,
  ClaimType,
  ClaimInfo,
  DispatchInfo,
  BuyerInfo,
  InternalOrderEvent,
} from '@packages/event-contracts/streams/adapter.stream';

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

