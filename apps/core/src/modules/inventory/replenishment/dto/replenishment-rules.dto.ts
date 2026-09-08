import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { demandGradeValues, replenishmentOverrideModeValues } from '../../schema/enum-values';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * α 는 (0, 1) **배타**다 — 정규 · 감마 분위수는 p = 0 · p = 1 에서 정의되지 않아
 * `policy/distributions.ts` 가 Error 를 던지고, 그게 그대로 새면 500 이 된다.
 * `@Min` / `@Max` 는 포함 경계라 이 범위를 표현하지 못한다.
 *
 * 2선 방어는 **SKU 예외에만** 있다 — `replenishment_sku_overrides` 의
 * `ck_replenishment_sku_overrides_alpha` 가 같은 조건을 DB 에서 다시 건다. `replenishment_grade_rules.alpha`
 * 에는 CHECK 제약이 없으므로 **등급 α 는 이 검증자가 유일한 방어선이다** — 지우지 말 것.
 */
function IsOpenUnitInterval(options?: ValidationOptions) {
  return function registerOpenUnitInterval(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isOpenUnitInterval',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1,
        defaultMessage: (args?: ValidationArguments) => `${args?.property ?? 'alpha'} 은(는) 0 초과 1 미만이어야 합니다.`,
      },
    });
  };
}

// ── 전역 ──
export class ReplenishmentSettingsDto {
  @ApiProperty() key: string;
  @ApiProperty() adiThreshold: number;
  @ApiProperty() cv2Threshold: number;
  @ApiProperty() classificationWindowDays: number;
  @ApiProperty() paramWindowDaysFrequent: number;
  @ApiProperty() paramWindowDaysSparse: number;
  @ApiProperty() minDemandEvents: number;
  @ApiProperty() minLeadTimeObservations: number;
  @ApiProperty() leadTimeWindowDays: number;
  @ApiProperty() gradeACut: number;
  @ApiProperty() gradeBCut: number;
  @ApiPropertyOptional({ nullable: true }) demandCoreSince: string | null;
  @ApiProperty() demandRecomputeDays: number;
  @ApiProperty() consolidationBufferDays: number;
  @ApiProperty() defaultLeadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) defaultLeadTimeStdDays: number | null;
  @ApiProperty() defaultTransferLeadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) defaultTransferLeadTimeStdDays: number | null;
  @ApiProperty() defaultLeadTimeCv: number;
  @ApiProperty() defaultCoverDays: number;
  @ApiProperty() defaultTransferCoverDays: number;
  @ApiProperty() updatedAt: string;
}

export class UpdateReplenishmentSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() adiThreshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() cv2Threshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(1095) classificationWindowDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(1095) paramWindowDaysFrequent?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(1095) paramWindowDaysSparse?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minDemandEvents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minLeadTimeObservations?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(1095) leadTimeWindowDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) gradeACut?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) gradeBCut?: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpdateReplenishmentSettingsDto) => o.demandCoreSince !== null)
  @Matches(ISO_DATE)
  demandCoreSince?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) demandRecomputeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) consolidationBufferDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) defaultLeadTimeDays?: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpdateReplenishmentSettingsDto) => o.defaultLeadTimeStdDays !== null)
  @IsNumber()
  @Min(0)
  defaultLeadTimeStdDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) defaultTransferLeadTimeDays?: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpdateReplenishmentSettingsDto) => o.defaultTransferLeadTimeStdDays !== null)
  @IsNumber()
  @Min(0)
  defaultTransferLeadTimeStdDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(2) defaultLeadTimeCv?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) defaultCoverDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) defaultTransferCoverDays?: number;
}

// ── 등급 ──
export class GradeRuleDto {
  @ApiProperty({ enum: demandGradeValues })
  @IsIn(demandGradeValues)
  grade: (typeof demandGradeValues)[number];

  @ApiProperty({ description: '목표 예측 실패율. (0, 1) 배타' })
  @IsNumber()
  @IsOpenUnitInterval()
  alpha: number;
}
export class GradeRulesDto {
  @ApiProperty({ type: [GradeRuleDto] }) items: GradeRuleDto[];
}
export class UpdateGradeRulesDto {
  @ApiProperty({ type: [GradeRuleDto], description: 'A · B · C 세 행 전부' })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GradeRuleDto)
  items: GradeRuleDto[];
}

// ── 공급사 · 경로 공통 ──
export class LeadTimeObservationDto {
  @ApiProperty() observations: number;
  @ApiProperty() meanDays: number;
  @ApiPropertyOptional({ nullable: true }) stdDays: number | null;
  @ApiProperty() windowFrom: string;
  @ApiProperty() windowTo: string;
}
export class LeadTimeRuleDto {
  @ApiProperty() leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) leadTimeStdDays: number | null;
  @ApiProperty() coverDays: number;
  @ApiProperty() updatedAt: string;
}
export class UpsertLeadTimeRuleDto {
  @ApiProperty() @IsNumber() @Min(0) leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpsertLeadTimeRuleDto) => o.leadTimeStdDays !== null)
  @IsNumber()
  @Min(0)
  leadTimeStdDays?: number | null;
  @ApiProperty() @IsInt() @Min(0) coverDays: number;
}

export class SupplierRuleRowDto {
  @ApiProperty() supplierId: string;
  @ApiProperty() supplierName: string;
  @ApiPropertyOptional({ nullable: true }) defaultWarehouseId: string | null;
  @ApiPropertyOptional({ type: LeadTimeRuleDto, nullable: true }) rule: LeadTimeRuleDto | null;
  @ApiPropertyOptional({ type: LeadTimeObservationDto, nullable: true }) observation: LeadTimeObservationDto | null;
}
export class SupplierRulesListDto {
  @ApiProperty({ type: [SupplierRuleRowDto] }) items: SupplierRuleRowDto[];
}

export class RouteRuleRowDto {
  @ApiProperty() fromWarehouseId: string;
  @ApiProperty() fromWarehouseName: string;
  @ApiProperty() toWarehouseId: string;
  @ApiProperty() toWarehouseName: string;
  @ApiPropertyOptional({ type: LeadTimeRuleDto, nullable: true }) rule: LeadTimeRuleDto | null;
  @ApiPropertyOptional({ type: LeadTimeObservationDto, nullable: true }) observation: LeadTimeObservationDto | null;
}
export class RouteRulesListDto {
  @ApiProperty({ type: [RouteRuleRowDto] }) items: RouteRuleRowDto[];
}

// ── SKU 예외 ──
export class ListSkuOverridesQueryDto {
  @ApiPropertyOptional({ description: 'SKU 코드 · 이름 부분 일치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
export class SkuOverrideRowDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ enum: replenishmentOverrideModeValues })
  mode: (typeof replenishmentOverrideModeValues)[number];
  @ApiPropertyOptional({ nullable: true }) excludedUntil: string | null;
  @ApiPropertyOptional({ nullable: true }) safetyStock: number | null;
  @ApiPropertyOptional({ nullable: true }) alpha: number | null;
  @ApiPropertyOptional({ nullable: true }) memo: string | null;
  @ApiProperty() updatedAt: string;
}
export class SkuOverridesListDto {
  @ApiProperty({ type: [SkuOverrideRowDto] }) items: SkuOverrideRowDto[];
}
export class UpsertSkuOverrideDto {
  @ApiProperty({ enum: replenishmentOverrideModeValues })
  @IsIn(replenishmentOverrideModeValues)
  mode: (typeof replenishmentOverrideModeValues)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpsertSkuOverrideDto) => o.excludedUntil !== null)
  @Matches(ISO_DATE)
  excludedUntil?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpsertSkuOverrideDto) => o.safetyStock !== null)
  @IsInt()
  @Min(0)
  safetyStock?: number | null;

  @ApiPropertyOptional({ nullable: true, description: '목표 예측 실패율 상속을 덮는다. (0, 1) 배타' })
  @IsOptional()
  @ValidateIf((o: UpsertSkuOverrideDto) => o.alpha !== null)
  @IsNumber()
  @IsOpenUnitInterval()
  alpha?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: UpsertSkuOverrideDto) => o.memo !== null)
  @IsString()
  @MaxLength(255)
  memo?: string | null;
}
