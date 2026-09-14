import { WarehouseOperationVersionDto } from '../../core/services/warehouse-operation-contract';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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

export class SimpleInboundDto extends WarehouseOperationVersionDto {
  @ApiProperty({ description: '타겟 창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ type: [SimpleInboundItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimpleInboundItemDto)
  items: SimpleInboundItemDto[];

  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  idempotencyKey: string;
}

export class IndividualInboundDto extends WarehouseOperationVersionDto {
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

  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  idempotencyKey: string;
}

export class PutawayRequestDto extends WarehouseOperationVersionDto {
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

  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  idempotencyKey: string;
}

export class ReturnInboundDto extends WarehouseOperationVersionDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '회송 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '회송 사유', required: false })
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  idempotencyKey: string;
}

export class CancelInboundDto extends WarehouseOperationVersionDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '취소 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  idempotencyKey: string;
}

export class UpdateInboundLineMemoDto {
  @ApiProperty({ description: '메모 내용', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  memo: string;
}
