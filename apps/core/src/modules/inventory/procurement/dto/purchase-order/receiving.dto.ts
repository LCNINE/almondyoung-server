import { WarehouseOperationVersionDto } from '../../../core/services/warehouse-operation-contract';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { IsCalendarDateConstraint } from '../../../shared/dto/calendar-date.validator';

@ValidatorConstraint({ name: 'uniqueSkuIds' })
class UniqueSkuIdsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    const skuIds: string[] = [];
    for (const line of value) {
      if (typeof line !== 'object' || line === null || !('skuId' in line) || typeof line.skuId !== 'string') {
        return false;
      }
      skuIds.push(line.skuId);
    }
    return new Set(skuIds).size === skuIds.length;
  }

  defaultMessage(): string {
    return '같은 품목이 두 번 들어 있습니다';
  }
}

export class ReceivePurchaseOrderLineDto {
  @ApiProperty()
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '1 이상의 정수' })
  @IsInt({ message: '수량은 1 이상의 정수여야 합니다' })
  @Min(1, { message: '수량은 1 이상이어야 합니다' })
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

export class ReceivePurchaseOrderDto extends WarehouseOperationVersionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @ApiProperty({ description: '요청한 현장의 창고. 발주 출발 창고와 같아야 한다' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ description: '비우면 입고기본존' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ type: [ReceivePurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: '받을 품목이 없습니다' })
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  @Validate(UniqueSkuIdsConstraint)
  lines: ReceivePurchaseOrderLineDto[];
}

export class CancelPurchaseOrderReceiptLineDto extends WarehouseOperationVersionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

export class ShortClosePurchaseOrderLineDto {
  @ApiProperty({ description: '잔량 포기 사유' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: '사유를 입력하세요' })
  @MaxLength(500)
  reason: string;
}

export class UpdateLineExpectedArrivalDto {
  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD 또는 null(비움)' })
  @IsDefined()
  @ValidateIf((_, value) => value !== null)
  @Validate(IsCalendarDateConstraint)
  expectedArrival: string | null;
}

export class PurchaseOrderReceiptLineResultDto {
  @ApiProperty()
  receiptLineId: string;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  quantity: number;
}

export class PurchaseOrderReceiptResponseDto {
  @ApiProperty()
  receiptId: string;

  @ApiProperty()
  poId: string;

  @ApiProperty({ type: [PurchaseOrderReceiptLineResultDto] })
  lines: PurchaseOrderReceiptLineResultDto[];
}

export class PurchaseOrderReceiptCancelResponseDto {
  @ApiProperty()
  poId: string;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  receiptLineId: string;
}
