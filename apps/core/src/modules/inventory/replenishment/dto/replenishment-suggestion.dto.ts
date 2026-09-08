import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const SUGGESTION_ACTION_FILTERS = ['purchase', 'transfer', 'all'] as const;
export type SuggestionActionFilter = (typeof SUGGESTION_ACTION_FILTERS)[number];

export class ListSuggestionsQueryDto {
  @ApiPropertyOptional({ enum: SUGGESTION_ACTION_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(SUGGESTION_ACTION_FILTERS)
  action?: SuggestionActionFilter;

  @ApiPropertyOptional({ description: '반환할 최대 행 수', default: 200, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class SuggestionSupplierDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class SuggestionDemandDto {
  @ApiProperty({ description: '일평균 수요 (파라미터 창)' }) dailyMean: number;
  @ApiProperty({ description: '일 수요 표준편차' }) dailyStd: number;
}

export class CompanyAxisDto {
  @ApiProperty() onHand: number;
  @ApiProperty() inTransfer: number;
  @ApiProperty() onOrder: number;
  @ApiProperty() reserved: number;
  @ApiProperty({ description: 'ON_HAND + IN_TRANSFER + 발주잔량 − 확정예약' }) position: number;
  @ApiProperty() safetyStock: number;
  @ApiProperty() reorderPoint: number;
  @ApiProperty() targetLevel: number;
  @ApiProperty() leadTimeDays: number;
}

export class SellableAxisDto {
  @ApiProperty() warehouseId: string;
  @ApiProperty() onHand: number;
  @ApiProperty() reserved: number;
  @ApiProperty() inTransit: number;
  @ApiProperty({ description: '판매창고로 직행하는 발주잔량' }) onOrderDirect: number;
  @ApiProperty({ description: 'ON_HAND − 예약 + 이동중 + 직행 발주잔량' }) position: number;
  @ApiProperty() safetyStock: number;
  @ApiProperty() reorderPoint: number;
  @ApiProperty() targetLevel: number;
  @ApiProperty() leadTimeDays: number;
  @ApiPropertyOptional({
    nullable: true,
    description: '예상 커버 일수 = 판매창고 재고위치 ÷ 일평균. 일평균 0 이면 null',
  })
  daysOfCover: number | null;
}

export class TransferLineSuggestionDto {
  @ApiProperty() fromLocationId: string;
  @ApiProperty() quantity: number;
}

export class SuggestionActionDto {
  @ApiProperty({ enum: ['purchase', 'transfer'] }) type: 'purchase' | 'transfer';
  @ApiProperty() qty: number;
  @ApiPropertyOptional({ nullable: true }) supplierId?: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceWarehouseId?: string | null;
  @ApiPropertyOptional() fromWarehouseId?: string;
  @ApiPropertyOptional() toWarehouseId?: string;
  @ApiPropertyOptional({ type: [TransferLineSuggestionDto] }) lines?: TransferLineSuggestionDto[];
}

export const SUGGESTION_FLAGS = ['default_lead_time', 'supplier_unknown', 'low_confidence'] as const;

export class ReplenishmentSuggestionRowDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiPropertyOptional({ type: SuggestionSupplierDto, nullable: true }) supplier: SuggestionSupplierDto | null;
  @ApiProperty({ enum: ['smooth', 'intermittent', 'erratic', 'lumpy', 'insufficient', 'none'] }) pattern: string;
  @ApiProperty({ enum: ['A', 'B', 'C'] }) grade: string;
  @ApiProperty({ enum: ['normal', 'low'] }) confidence: string;
  @ApiProperty({ type: SuggestionDemandDto }) demand: SuggestionDemandDto;
  @ApiProperty({ type: CompanyAxisDto }) company: CompanyAxisDto;
  @ApiProperty({ type: SellableAxisDto }) sellable: SellableAxisDto;
  @ApiProperty({ type: [SuggestionActionDto] }) actions: SuggestionActionDto[];
  @ApiProperty({ enum: SUGGESTION_FLAGS, isArray: true }) flags: string[];
  @ApiProperty({ description: '레거시 방식 재주문점 (μ_D(90일)·μ_L 전사)' }) legacyReorderPoint: number;
}

export class ReplenishmentSuggestionListDto {
  @ApiProperty({ type: [ReplenishmentSuggestionRowDto] }) items: ReplenishmentSuggestionRowDto[];
  @ApiProperty({ description: '판정한 SKU 수 (excluded 제외)' }) evaluated: number;
  @ApiProperty({ description: '조건에 맞는 SKU 총수 (limit 적용 전)' }) total: number;
}

export class SkuDemandProfileDto {
  @ApiProperty({ enum: ['smooth', 'intermittent', 'erratic', 'lumpy', 'insufficient', 'none'] }) pattern: string;
  @ApiProperty({ enum: ['A', 'B', 'C'] }) grade: string;
  @ApiPropertyOptional({ nullable: true }) adi: number | null;
  @ApiPropertyOptional({ nullable: true }) cv2: number | null;
  @ApiProperty() dailyMean: number;
  @ApiProperty() dailyStd: number;
  @ApiProperty() dailyMean90: number;
  @ApiPropertyOptional({ nullable: true }) sizeMean: number | null;
  @ApiPropertyOptional({ nullable: true }) sizeStd: number | null;
  @ApiPropertyOptional({ nullable: true }) intervalMean: number | null;
  @ApiProperty() historyDays: number;
  @ApiProperty() demandEvents: number;
  @ApiProperty() classificationFrom: string;
  @ApiProperty() classificationTo: string;
  @ApiProperty() paramFrom: string;
  @ApiProperty() paramTo: string;
  @ApiProperty() computedAt: string;
}

export class SourcedNumberDto {
  @ApiProperty() value: number;
  @ApiProperty({ enum: ['override', 'grade', 'observation', 'supplier_rule', 'route_rule', 'global_default'] })
  source: string;
}

export class ResolvedSegmentDto {
  @ApiProperty() meanDays: number;
  @ApiProperty() stdDays: number;
  @ApiProperty({ enum: ['observation', 'supplier_rule', 'route_rule', 'global_default'] }) source: string;
}

export class EffectiveParametersDto {
  @ApiProperty() excluded: boolean;
  @ApiProperty({ type: SourcedNumberDto }) alpha: SourcedNumberDto;
  @ApiProperty({ type: ResolvedSegmentDto }) l1: ResolvedSegmentDto;
  /** R1(i): 경로 규칙·관측이 없어도 전역 이동 기본으로 떨어지므로 null 이 아니다. */
  @ApiProperty({ type: ResolvedSegmentDto }) l2: ResolvedSegmentDto;
  @ApiProperty({ type: SourcedNumberDto }) coverDays: SourcedNumberDto;
  @ApiProperty({ type: SourcedNumberDto }) transferCoverDays: SourcedNumberDto;
  @ApiPropertyOptional({ nullable: true }) overrideSafetyStock: number | null;
  @ApiProperty() usesDefaultLeadTime: boolean;
}

export class ReplenishmentSkuDetailDto extends ReplenishmentSuggestionRowDto {
  @ApiPropertyOptional({ type: SkuDemandProfileDto, nullable: true, description: '야간 배치가 아직 안 돌았으면 null' })
  profile: SkuDemandProfileDto | null;

  @ApiProperty({ type: EffectiveParametersDto }) parameters: EffectiveParametersDto;
}
