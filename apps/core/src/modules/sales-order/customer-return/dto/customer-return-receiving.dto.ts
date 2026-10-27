import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CustomerReturnArrivalItemDto {
  @ApiProperty({ description: '반품 SKU 항목 id(customer_return_items.id)' })
  @IsUUID()
  customerReturnItemId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

/** 반품 도착 — 한 소포에 든 항목들. 같은 키의 재요청은 같은 결과를 돌려준다(N4). */
export class RecordCustomerReturnArrivalDto {
  @ApiProperty({ description: '받은 창고 — 그 주문을 배송완료한 창고여야 한다' })
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ type: [CustomerReturnArrivalItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerReturnArrivalItemDto)
  items: CustomerReturnArrivalItemDto[];

  @ApiProperty({ maxLength: 128, description: '스테이션이 소포마다 만드는 키. 항목마다 `<key>:<itemId>` 로 넓혀 쓴다' })
  @IsString()
  @Matches(/\S/)
  // 도착 행 키(varchar 255) = 이 키 + ':' + uuid
  @MaxLength(128)
  idempotencyKey: string;
}

export class CustomerReturnInspectionItemDto {
  @ApiProperty({ description: '반품 SKU 항목 id(customer_return_items.id)' })
  @IsUUID()
  customerReturnItemId: string;

  @ApiProperty({ minimum: 0, description: '양품 — 판매 가능 재고로' })
  @IsInt()
  @Min(0)
  accepted: number;

  @ApiProperty({ minimum: 0, description: '불량' })
  @IsInt()
  @Min(0)
  rejected: number;

  @ApiProperty({ minimum: 0, description: '환불 보류 — 하나라도 있으면 정산하지 않고 멈춘다' })
  @IsInt()
  @Min(0)
  held: number;
}

/** 반품 검수 — 모든 항목을 한 번씩, 합은 도착 수량과 같아야 한다(N6). */
export class RecordCustomerReturnInspectionDto {
  @ApiProperty({ type: [CustomerReturnInspectionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerReturnInspectionItemDto)
  items: CustomerReturnInspectionItemDto[];
}
