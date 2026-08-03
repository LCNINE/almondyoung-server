/** SkuResponseDto.barcodes[] 한 행. packingUnit 은 바코드마다 다르다. */
export interface SkuBarcodeItem {
  id: string;
  barcode: string;
  isPrimary: boolean;
  /** 이 바코드 1회 스캔이 뜻하는 낱개 수량. 미설정이면 null. */
  packingUnit?: number | null;
}

/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  /** search/advanced 응답에서 계산되는 현재고(전 창고 합산 또는 warehouseId 한정). */
  currentStock: number;
  /** 안전재고. 0이면 부족 판정 제외. */
  safetyStock: number;
  /**
   * GET /inventory/skus?barcode= 응답에만 담긴다(search/advanced 에는 없다).
   * 입고 화면이 "스캔한 바코드의 포장단위"를 고르는 데 쓴다.
   */
  barcodes?: SkuBarcodeItem[];
}

/** GET /inventory/skus/:id — SkuResponseDto 중 현장에서 쓰는 필드만. */
export interface SkuDetail {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  safetyStock: number;
  barcodes: Array<{ id: string; barcode: string; isPrimary: boolean }>;
}

/** GET /inventory/skus/:id/stock-summary — 창고 단위 집계. */
export interface SkuStockSummary {
  skuId: string;
  skuName: string;
  skuCode: string;
  totalRealQuantity: number;
  totalReservedQuantity: number;
  totalAvailableQuantity: number;
  warehouseStocks: Array<{
    warehouseId: string;
    warehouseName: string;
    realQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
}

/**
 * GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId 의 details[] 한 행.
 * stock_ledgers 는 location_id 가 NOT NULL 이고 복합 PK 의 일부라 위치 없는 재고 행은 존재할 수 없다.
 */
export interface StockDetailRow {
  locationId: string;
  locationCode: string;
  stockState: string;
  quantity: number;
}

export interface SkuWarehouseStock {
  summary: {
    currentQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
  } | null;
  details: StockDetailRow[];
}
