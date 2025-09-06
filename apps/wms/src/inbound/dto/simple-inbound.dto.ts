import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsArray, ValidateNested, IsNumber, Min, IsOptional, IsDateString, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SimpleInboundItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class SimpleInboundDto {
  @ApiProperty({ description: '타겟 창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ type: [SimpleInboundItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimpleInboundItemDto)
  items: SimpleInboundItemDto[];
}

export class IndividualInboundDto {
  @ApiProperty({ description: '타겟 창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '타겟 로케이션 ID', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class PutawayRequestDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '목적지 로케이션 ID' })
  @IsUUID()
  @IsNotEmpty()
  toLocationId: string;

  @ApiProperty({ description: '이동 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class ReturnInboundDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '회송 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CancelInboundDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '취소 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateInboundPlanDto {
  @ApiProperty({ description: '예정일 (YYYY-MM-DD)' })
  @IsDateString()
  expectedDate: string;

  @ApiProperty({ description: '창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;
}

export class InboundPlanItemInputDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '예정 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  expectedQty: number;
}

export class AddInboundPlanItemsDto {
  @ApiProperty({ description: '입고예정 ID' })
  @IsUUID()
  @IsNotEmpty()
  planId: string;

  @ApiProperty({ type: [InboundPlanItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundPlanItemInputDto)
  items: InboundPlanItemInputDto[];
}

export class ReceiveFromPlanDto {
  @ApiProperty({ description: '입고예정 아이템 ID' })
  @IsUUID()
  @IsNotEmpty()
  planItemId: string;

  @ApiProperty({ description: '실입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '입고 로케이션 ID(옵션)', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class UpdateInboundLineMemoDto {
  @ApiProperty({ description: '메모 내용', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  memo: string;
}

export class ListPlanItemsQueryDto {
  @ApiProperty({ description: '시작일 (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '종료일 (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: '창고 ID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'SKU ID', required: false })
  @IsOptional()
  @IsUUID()
  skuId?: string;
}


