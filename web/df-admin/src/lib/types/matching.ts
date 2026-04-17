export type MatchingStatus = "pending" | "matched" | "ignored"
export type MatchingStatusFilter = MatchingStatus | "unregistered"
export type MatchingStrategy = "variant" | "void"
export type MatchingPriority = "high" | "normal"
export type KeywordType = "productName" | "orderNumber" | "customerName"

export type MatchedSku = {
  skuId: string
  skuName: string
  skuCode?: string
  quantity: number
}

export type OrderLineRow = {
  id: string
  variantId: string
  productName: string
  quantity: number
  unitPrice?: number
  totalPrice?: number
  salesOrderId: string
  channelOrderId: string
  salesChannel: string
  customerName?: string
  customerPhone?: string
  orderDate: string
  matchingId?: string
  matchingStatus?: MatchingStatus
  matchedSkus: MatchedSku[]
}

export type OrderLinesResponse = {
  data: OrderLineRow[]
  total: number
  page: number
  limit: number
}

export type OrderLineQuery = {
  matchingStatus?: MatchingStatusFilter
  excludeMatched?: boolean
  salesChannel?: string
  startDate?: string
  endDate?: string
  keyword?: string
  keywordType?: KeywordType
  limit?: number
  offset?: number
}

export type StockPolicyDto = {
  inventoryManagement?: boolean
  preStockSellable?: boolean
  alwaysSellableZeroStock?: boolean
}

export type SkuMappingDto = {
  skuId: string
  quantity?: number
}

export type ResolveMatchingDto = {
  skuIds?: string[]
  skuMappings?: SkuMappingDto[]
  ignore?: boolean
  strategy?: MatchingStrategy
  stockPolicy?: StockPolicyDto
  isGift?: boolean
}

export type MatchingLinkDto = {
  skuId: string
  quantity: number
}

export type MatchingPolicyDto = {
  inventoryManagement?: boolean
  preStockSellable?: boolean
  alwaysSellableZeroStock?: boolean
}

export type UpsertMatchingDto = {
  masterId?: string | null
  links: MatchingLinkDto[]
  policy?: MatchingPolicyDto
}

export type VariantMatchingDto = {
  id: string
  variantId: string
  masterId?: string | null
  status: MatchingStatus
  strategy: MatchingStrategy
  priority: MatchingPriority
  isResolved: boolean
  inventoryManagement: boolean
  preStockSellable: boolean
  alwaysSellableZeroStock: boolean
  createdAt?: string
  updatedAt?: string
  links: Array<{
    id: string
    productMatchingId: string
    skuId: string
    quantity: number
  }>
}

export type VariantStockPolicy = {
  inventoryManagement: boolean
  preStockSellable: boolean
  alwaysSellableZeroStock: boolean
}

export type MasterBatchStat = {
  masterId: string
  totalVariants: number
  matchedVariants: number
  pendingVariants: number
  ignoredVariants: number
  matchingRate: number
}
