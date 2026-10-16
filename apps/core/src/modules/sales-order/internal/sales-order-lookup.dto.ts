import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export const LOOKUP_SALES_CHANNELS = ['medusa', 'naver', 'coupang'] as const;
export type LookupSalesChannel = (typeof LOOKUP_SALES_CHANNELS)[number];
export const LOOKUP_MAX_ORDERS = 200;

export class SalesOrderLookupItemDto {
  @IsString()
  @MaxLength(255)
  externalOrderId!: string;

  /** 어댑터가 발급한 주문 id(`wms_order_mappings.wms_order_id`). dead letter 의 순서 키다. */
  @IsOptional()
  @IsUUID()
  wmsOrderId?: string;
}

export class SalesOrderLookupRequestDto {
  @IsIn(LOOKUP_SALES_CHANNELS)
  salesChannel!: LookupSalesChannel;

  @ValidateNested({ each: true })
  @Type(() => SalesOrderLookupItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(LOOKUP_MAX_ORDERS)
  orders!: SalesOrderLookupItemDto[];
}

export interface SalesOrderLookupResult {
  externalOrderId: string;
  salesOrder: { status: string } | null;
  openEventFailure: boolean;
}

export interface SalesOrderLookupResponse {
  orders: SalesOrderLookupResult[];
}
