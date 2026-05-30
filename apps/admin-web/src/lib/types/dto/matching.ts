// src/lib/types/dto/matching.ts
// 상품 매칭 관련 DTO 타입 정의

export type MatchingStatus = 'pending' | 'matched' | 'ignored';
export type MatchingStrategy = 'void' | 'variant';
export type MatchingPriority = 'normal' | 'high';
export type LegacyIgnoredResolutionTarget = 'pending' | 'void';

export interface StockPolicyDto {
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
}

export interface SkuMappingDto {
  skuId: string;
  quantity: number;
}

export interface OptionMappingDto {
  optionName: string;
  optionValue: string;
  skuId: string;
}

export interface ResolveMatchingDto {
  skuIds?: string[];
  skuMappings?: SkuMappingDto[];
  ignore?: boolean;
  resolveAsVoid?: boolean;
  strategy?: MatchingStrategy;
  stockPolicy: StockPolicyDto;
  isGift: boolean;
}

export interface ResolveOptionMatchingDto {
  optionMappings: OptionMappingDto[];
}

export interface SetMatchingPriorityDto {
  priority: MatchingPriority;
}

export interface ChangeStrategyDto {
  strategy: MatchingStrategy;
}

export interface ResolveLegacyIgnoredMatchingDto {
  target: LegacyIgnoredResolutionTarget;
  stockPolicy?: StockPolicyDto;
}

export interface SelectedOptionDto {
  optionName: string;
  optionValue: string;
}

export interface VariantSkuLookupDto {
  selectedOptions?: SelectedOptionDto[];
}

export interface MatchingDto {
  id: string;
  variantId: string;
  status: MatchingStatus;
  priority: MatchingPriority;
  strategy?: MatchingStrategy;
  stockPolicy: StockPolicyDto;
  isGift: boolean;
  orderCount?: number;
  skuLinkCount?: number;
  hasSkuLinks?: boolean;
  createdAt: string;
  updatedAt: string;
  order?: {
    id: string;
    salesOrderId: string;
    salesChannel: string;
    channelOrderId: string;
    productName: string;
    optionName?: string;
    quantity: number;
    salesAmount: number;
    recipient: string;
    orderDate: string;
    shippingAddress?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  };
  matchedSkus?: SkuMappingDto[];
  links?: SkuMappingDto[];
  variant?: {
    id: string;
    name: string;
    masterId: string;
    optionKey?: Record<string, string>;
  };
  master?: {
    id: string;
    name: string;
  };
}

export interface MatchingsQuery {
  status?: MatchingStatus;
  limit?: number;
  offset?: number;
}

export interface MatchingsResponseDto {
  data: MatchingDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface OrderLineMatchedSku {
  skuId: string;
  skuName: string;
  skuCode?: string;
  quantity: number;
}

export interface OrderLineDto {
  id: string;
  variantId: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  salesOrderId: string;
  channelOrderId: string;
  salesChannel: string;
  customerName?: string;
  customerPhone?: string;
  orderDate: string;
  matchingId?: string;
  matchingStatus?: MatchingStatus;
  matchingStrategy?: MatchingStrategy;
  matchedSkus: OrderLineMatchedSku[];
}

export interface OrderLinesResponseDto {
  data: OrderLineDto[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderLinesQuery {
  matchingStatus?: MatchingStatus | 'unregistered';
  excludeMatched?: boolean;
  salesChannel?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  keywordType?: 'productName' | 'orderNumber' | 'customerName';
  limit?: number;
  offset?: number;
}

export interface VariantMatchingDto {
  id?: string;
  variantId: string;
  status: MatchingStatus;
  strategy?: MatchingStrategy;
  priority?: MatchingPriority;
  stockPolicy: StockPolicyDto;
  isGift: boolean;
  matchedSkus?: SkuMappingDto[];
  links?: SkuMappingDto[];
  createdAt: string;
  updatedAt: string;
}

export interface VariantSkuLookupResponseDto {
  skuId: string;
  quantity: number;
}

export interface ResolveMatchingResponseDto {
  id: string;
  status: MatchingStatus;
  message: string;
}

export interface SetMatchingPriorityResponseDto {
  id: string;
  priority: MatchingPriority;
}

export interface ChangeStrategyResponseDto {
  id: string;
  strategy: MatchingStrategy;
}

export interface UpdateStockPolicyResponseDto {
  id: string;
  stockPolicy: StockPolicyDto;
}

/** PUT /matchings/:variantId 요청 바디 */
export interface UpsertMatchingDto {
  masterId?: string | null;
  links: { skuId: string; quantity: number }[];
  policy?: Partial<StockPolicyDto>;
}

/** GET /matchings/masters/batch-stats 응답 단건 */
export interface MasterMatchingStatsDto {
  masterId: string;
  totalVariants: number;
  matchedVariants: number;
  pendingVariants: number;
  ignoredVariants: number;
  matchingRate: number;
}
