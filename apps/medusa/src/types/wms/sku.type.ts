export interface Barcode {
  id: string;
  barcode: string;
  barcodeType: string;
  packingUnit?: string;
}

export interface Sku {
  id: string;
  name: string;
  code: string;
  defaultBarcode?: string;
  deliveryProfileId?: string;
  inventoryManagement: boolean;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
  sale1m?: number;
  sale3m?: number;
  barcodes: Barcode[];
  supplierNames: string[];
  categoryNames: string[];
  createdAt: Date;
  updatedAt: Date;
}
