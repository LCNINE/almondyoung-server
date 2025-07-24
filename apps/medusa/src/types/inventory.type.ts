export interface StockRow {
  id: string;
  realQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  creatorEventId: string;
  subBarcode?: string;
  packingUnit?: string;
}

export interface WMSStockResponse {
  skuId: string;
  warehouseId: string;
  locationId?: string;
  expiryDate?: string;
  stockType: 'physical' | 'virtual' | string;
  realQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  stockRows: StockRow[];
}

export interface InventoryPolicy {
  inventoryManagement: boolean;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
}

export interface ProductInventoryStatus {
  isAvailable: boolean;
  availableQuantity: number;
  status: 'in_stock' | 'out_of_stock' | 'backorder' | 'always_available';
  message?: string;
}
