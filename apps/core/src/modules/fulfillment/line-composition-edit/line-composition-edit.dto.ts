import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LineCompositionItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '판매 1개당 SKU 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10000)
  qtyPerUnit: number;
}

export class PutLineCompositionDto {
  @ApiProperty({ type: [LineCompositionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineCompositionItemDto)
  items: LineCompositionItemDto[];

  @ApiProperty({ required: false, description: '운영자 메모 — amendment 에 남는다' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LineCompositionChangeResponseDto {
  @ApiProperty() salesOrderLineId: string;
  @ApiProperty({ enum: ['matching', 'operator'] }) source: string;
  @ApiProperty({ type: [LineCompositionItemDto] }) items: LineCompositionItemDto[];
  @ApiProperty({ type: [String], description: '내용이 바뀐 박스' }) changedShipmentIds: string[];
  @ApiProperty({ nullable: true, description: '박스가 바뀌었을 때만 남는 amendment' }) amendmentId: string | null;
}

export class ExistingLinesImpactResponseDto {
  @ApiProperty() variantId: string;
  @ApiProperty({ description: '상품매칭이 실물 SKU 로 해결됐나 — 아니면 적용할 것이 없다' }) applicable: boolean;
  @ApiProperty({ type: [LineCompositionItemDto], nullable: true }) newComposition: LineCompositionItemDto[] | null;
  @ApiProperty({ description: '바꿀 수 있음' }) changeable: number;
  @ApiProperty({ description: '개별 지정이라 건너뜀' }) skippedOperator: number;
  @ApiProperty({ description: '작업 중 박스라 건너뜀' }) skippedInProgress: number;
  @ApiProperty({ description: '이미 같음' }) alreadySame: number;
}

export class ApplySkippedCountDto {
  @ApiProperty({ enum: ['operator', 'in_progress', 'same', 'units_ambiguous', 'not_applicable'] }) reason: string;
  @ApiProperty() count: number;
}

export class ApplyToExistingLinesResponseDto {
  @ApiProperty() changed: number;
  @ApiProperty({ type: [ApplySkippedCountDto] }) skipped: ApplySkippedCountDto[];
}
