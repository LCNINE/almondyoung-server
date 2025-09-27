import { Sku } from './sku.type';

export enum StockType {
  PHYSICAL = 'physical',
  INFINITE = 'infinite',
  DROP_SHIPPED = 'drop_shipped',
  CONSIGNMENT = 'consignment',
}

export interface GetStockQueryDto {
  skuId?: string;
  warehouseId?: string;
  locationId?: string;
  stockType?: StockType;
  asOfTimestamp?: string;
}

export interface StockRow {
  id: string;
  realQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  creatorEventId: string;
  subBarcode?: string;
  packingUnit?: string;
}

export interface Stock {
  skuId: string;
  warehouseId: string;
  locationId?: string;
  expiryDate?: string;
  stockType: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';
  realQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  stockRows: StockRow[];
}

// API 응답 타입
export type GetStockResponse = Stock[];

// 재고 상태 응답
export interface StockAvailability {
  isAvailable: boolean;
  availableQuantity: number;
  status: 'in_stock' | 'out_of_stock' | 'backorder' | 'always_available';
  message?: string;
}

// 장바구니 추가 가능 여부 응답
export interface CartAvailabilityResponse {
  canAddToCart: boolean;
  reason?: string;
  availableQuantity: number;
  skuInfo?: Sku;
}

// 재고 관리 정책
export interface StockPolicy {
  inventoryManagement: boolean;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
}
