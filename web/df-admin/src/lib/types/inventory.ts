export type StockType = "physical" | "infinite" | "drop_shipped" | "consignment"

export type BarcodeDto = {
  id: string
  barcode: string
  isPrimary: boolean
  packingUnit?: string | null
}

export type SupplierInfoDto = {
  id: string
  name: string
}

export type SkuGroupMiniDto = {
  id: string
  code?: string | null
  name?: string | null
}

export type SkuImageDto = {
  id: string
  url: string
  sortOrder: number
}

export type SkuDto = {
  id: string
  name: string
  code: string
  deliveryProfileId?: string | null
  stockType: StockType
  sale1m?: number | null
  sale3m?: number | null
  safetyStock: number
  groupId?: string | null
  optionKey?: string | null
  skuGroup?: SkuGroupMiniDto | null
  barcodes: BarcodeDto[]
  suppliers: SupplierInfoDto[]
  categoryNames: string[]

  businessProductName?: string | null
  importDeclarationNumber?: string | null
  logisticsPartnerId?: string | null
  discount?: string | null
  manufacturerStar?: string | null

  productWeight?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  dimensionDepth?: number | null
  productMaterial?: string | null

  koreanName?: string | null
  maxDiscountQuantity?: number | null
  packagingImporterName?: string | null

  productDescription?: string | null
  moq?: number | null
  memo2?: string | null
  memo3?: string | null

  mainImageUrl?: string | null
  images?: SkuImageDto[]

  currentStock?: number | null

  expiryDateManagement: boolean
  expiryStartDate?: string | null
  expiryEndDate?: string | null
  manufacturingDateManagement: boolean
  isGeneralInventory: boolean
  validityStartDate?: string | null
  validityEndDate?: string | null

  primaryLocationId?: string | null
  secondaryLocationId?: string | null

  variantGroupCode?: string | null

  isDeleted: boolean
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type SkuOffsetPaginatedResponse<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type StockDisplayMode =
  | "all"
  | "below_safety"
  | "with_stock"
  | "out_of_stock"

export type SkuAdvancedQuery = {
  search?: string
  displayMode?: StockDisplayMode
  supplierId?: string
  warehouseId?: string
  stockType?: StockType
  barcode?: string
  groupId?: string
  limit?: number
  offset?: number
  sortBy?: "name" | "code" | "createdAt" | "updatedAt" | "safetyStock"
  sortOrder?: "asc" | "desc"
}

export type DeletedSkuQuery = {
  search?: string
  deletedStartDate?: string
  deletedEndDate?: string
  limit?: number
  offset?: number
}

export type CreateSkuDto = {
  name: string
  skuGroupId?: string
  holderId?: string
  optionKey?: string
  source?: "auto_matching" | "manual_matching" | "manual_entry"
  deliveryProfileId?: string
  stockType?: StockType
  sale1m?: number
  sale3m?: number
  safetyStock?: number
  supplierIds?: string[]
  categoryIds?: string[]

  businessProductName?: string
  importDeclarationNumber?: string
  logisticsPartnerId?: string
  discount?: string
  manufacturerStar?: string

  productWeight?: number
  dimensionWidth?: number
  dimensionHeight?: number
  dimensionDepth?: number
  productMaterial?: string

  koreanName?: string
  maxDiscountQuantity?: number
  packagingImporterName?: string

  productDescription?: string
  moq?: number
  memo2?: string
  memo3?: string

  mainImageUrl?: string
  imageUploadIds?: string[]
  currentStock?: number

  expiryDateManagement?: boolean
  expiryStartDate?: string
  expiryEndDate?: string
  manufacturingDateManagement?: boolean
  isGeneralInventory?: boolean
  validityStartDate?: string
  validityEndDate?: string

  primaryLocationId?: string
  secondaryLocationId?: string

  variantGroupCode?: string
}

export type UpdateSkuDto = Partial<CreateSkuDto>

export type AddBarcodeDto = {
  barcode: string
  packingUnit?: string
}

export type SkuWarehouseStock = {
  warehouseId: string
  warehouseName: string
  realQuantity: number
  reservedQuantity: number
  availableQuantity: number
}

export type SkuStockSummaryDto = {
  skuId: string
  skuName: string
  skuCode: string
  totalRealQuantity: number
  totalReservedQuantity: number
  totalAvailableQuantity: number
  warehouseStocks: SkuWarehouseStock[]
}
