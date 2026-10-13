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
