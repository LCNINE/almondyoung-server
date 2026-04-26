// src/lib/types/ui/matching.ts
// 상품 매칭 화면 전용 UI 타입

import type { MasterDto, VariantDto } from '@/lib/types/dto/products';
import type {
  MasterMatchingStatsDto,
  VariantMatchingDto,
  StockPolicyDto,
  MatchingStrategy,
  MatchingPriority,
} from '@/lib/types/dto/matching';

/** 마스터 목록 행 = MasterDto + 매칭 통계 */
export interface MasterMatchingRowVM extends MasterDto {
  matchingStats: MasterMatchingStatsDto | null;
}

/** variant 편집 다이얼로그 내 링크(SKU 매핑) 상태 */
export interface SkuLinkState {
  skuId: string;
  skuName?: string;
  quantity: number;
}

/** variant 편집 다이얼로그의 편집 중 상태 */
export interface VariantEditorState {
  variantId: string;
  variant: VariantDto;
  current: VariantMatchingDto | null;
  links: SkuLinkState[];
  strategy: MatchingStrategy;
  priority: MatchingPriority;
  stockPolicy: StockPolicyDto;
  isDirty: boolean;
}
