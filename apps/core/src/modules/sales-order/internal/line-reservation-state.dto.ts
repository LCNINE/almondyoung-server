import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';

export const LINE_STATE_SALES_CHANNELS = ['medusa', 'naver', 'coupang', '3pl'] as const;
export const LINE_STATE_MAX_ITEMS = 200;
export const LINE_CANDIDATES_MAX_LIMIT = 500;

export class LineReservationStatesRequestDto {
  @IsIn(LINE_STATE_SALES_CHANNELS)
  salesChannel!: SalesOrderLineReservationStatePayload['salesChannel'];

  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(LINE_STATE_MAX_ITEMS)
  channelOrderItemIds!: string[];
}

export class LineReservationCandidatesRequestDto {
  @IsIn(LINE_STATE_SALES_CHANNELS)
  salesChannel!: SalesOrderLineReservationStatePayload['salesChannel'];

  @Type(() => Date)
  @IsDate()
  orderedAtOrAfter!: Date;

  @IsOptional()
  @IsUUID()
  afterLineId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LINE_CANDIDATES_MAX_LIMIT)
  limit!: number;
}

export type LineReservationStateLine = SalesOrderLineReservationStatePayload['lines'][number] & {
  salesOrderId: string;
  orderedAt: string;
};

export interface LineReservationStatesResponse {
  lines: LineReservationStateLine[];
  /** 그 채널에 줄이 없는 id. */
  unknown: string[];
}

export interface LineReservationCandidatesResponse {
  channelOrderItemIds: string[];
  nextAfterLineId: string | null;
}
