import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const MAX_RECEIVE_ITEMS = 500;

export class ReceiveBoxCountDto {
  @ApiProperty({ description: '이 상자를 덮는 리스트 줄' })
  @IsUUID()
  lineId: string;

  @ApiProperty({ minimum: 0, description: '센 수량. 0 은 «열어 봤는데 없었다»' })
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  countedQty: number;
}

export class ReceiveBoxUnplannedDto {
  @ApiProperty({ description: '리스트에 없던 물건의 SKU' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(POSTGRES_INTEGER_MAX)
  quantity: number;
}

/**
 * 상자 확정 — 창고 작업 계약 v2 만 받는다 (spec §8.2).
 *
 * 부모 `WarehouseOperationDto` 의 `@ValidateIf(값이 있을 때만)` 를 같은 속성의 `@ValidateIf(() => true)` 로 덮는다.
 * class-validator 는 같은 속성·같은 종류의 메타데이터가 자식에 있으면 부모 것을 버리므로, 부모의 규칙
 * (IsString·Matches·MaxLength)도 여기서 다시 적는다 — 빠뜨리면 그 규칙이 조용히 사라진다.
 */
export class ReceiveBoxDto extends WarehouseOperationDto {
  @ApiProperty({ enum: [2] })
  @ValidateIf(() => true)
  @Equals(2)
  declare contractVersion: number;

  @ApiProperty({ maxLength: 90 })
  @ValidateIf(() => true)
  @IsString()
  @Matches(/\S/)
  @MaxLength(90)
  declare idempotencyKey: string;

  @ApiProperty({ type: [ReceiveBoxCountDto], description: '이 상자를 덮는 줄 전부를 정확히 한 번씩(0 포함)' })
  @IsArray()
  @ArrayMaxSize(MAX_RECEIVE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ReceiveBoxCountDto)
  counts: ReceiveBoxCountDto[];

  @ApiProperty({ type: [ReceiveBoxUnplannedDto], description: '리스트에 없던 물건' })
  @IsArray()
  @ArrayMaxSize(MAX_RECEIVE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ReceiveBoxUnplannedDto)
  unplanned: ReceiveBoxUnplannedDto[];
}

/**
 * 상자 확정 취소 — 창고 작업 계약 v2 만 받는다 (spec §8.3). 본문은 계약 필드뿐이다.
 * `ReceiveBoxDto` 와 같은 이유로 부모의 규칙을 다시 적는다 — 빠뜨리면 그 규칙이 조용히 사라진다.
 */
export class CancelBoxReceiptDto extends WarehouseOperationDto {
  @ApiProperty({ enum: [2] })
  @ValidateIf(() => true)
  @Equals(2)
  declare contractVersion: number;

  @ApiProperty({ maxLength: 90 })
  @ValidateIf(() => true)
  @IsString()
  @Matches(/\S/)
  @MaxLength(90)
  declare idempotencyKey: string;
}

export class AddInboundShipmentBoxDto {
  @ApiProperty({ description: '리스트에 없던 상자 이름(`L99`). 범위 표기는 받지 않는다' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  label: string;
}

export class ReceiveBoxResultDto {
  @ApiProperty() boxId: string;
  @ApiPropertyOptional({ nullable: true, description: '재고에 들어간 줄이 없으면 null' }) receiptId: string | null;
  @ApiProperty({ enum: ['draft', 'expected', 'receiving', 'closed', 'canceled'] })
  shipmentStatus: 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled';
  @ApiProperty({ type: [String], description: '집계 행 id — counts 순서, 그다음 unplanned 순서' }) countIds: string[];
}

export class CancelBoxReceiptResultDto {
  @ApiProperty() boxId: string;
  @ApiProperty({ enum: ['draft', 'expected', 'receiving', 'closed', 'canceled'] })
  shipmentStatus: 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled';
  @ApiProperty({ type: [String], description: '취소한 집계 행 id' }) canceledCountIds: string[];
}

export class AddInboundShipmentBoxResultDto {
  @ApiProperty() boxId: string;
  @ApiProperty() label: string;
}

export class BoxCandidateViewDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() shipmentName: string;
  @ApiPropertyOptional({ nullable: true }) expectedArrival: string | null;
  @ApiProperty() boxId: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['stock', 'forward'] }) disposition: 'stock' | 'forward';
  @ApiProperty({ enum: ['open', 'received'] }) status: 'open' | 'received';
  @ApiProperty({ type: [String], description: '그 상자 줄의 제품명 원문 앞 3개(행 순)' }) previewItems: string[];
}

export class BoxLineViewDto {
  @ApiProperty() lineId: string;
  @ApiProperty({ enum: ['sku', 'free', 'unresolved'] }) kind: 'sku' | 'free' | 'unresolved';
  @ApiPropertyOptional({ nullable: true }) skuId: string | null;
  @ApiProperty({ description: '제품명 원문' }) productName: string;
  @ApiProperty({ description: '옵션 원문' }) option: string;
  @ApiPropertyOptional({ nullable: true, description: '줄 전체 예정 수량(범위 줄이면 덮는 상자 합계)' })
  expectedQty: number | null;
  @ApiProperty({ type: [String] }) coversBoxLabels: string[];
  @ApiProperty({ description: '같은 줄을 다른 상자에서 이미 센 수량(취소분 제외)' }) alreadyCountedInOtherBoxes: number;
  @ApiProperty({ description: '비고 원문' }) remark: string;
}

export class BoxCountViewDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true, description: 'null = 리스트에 없던 물건' }) lineId: string | null;
  @ApiPropertyOptional({ nullable: true }) skuId: string | null;
  @ApiProperty() countedQty: number;
}

export class BoxViewDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() shipmentName: string;
  @ApiProperty({ enum: ['draft', 'expected', 'receiving', 'closed', 'canceled'] })
  shipmentStatus: 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled';
  @ApiPropertyOptional({ nullable: true }) expectedArrival: string | null;
  @ApiProperty() boxId: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['list', 'added'] }) origin: 'list' | 'added';
  @ApiProperty({ enum: ['stock', 'forward'] }) disposition: 'stock' | 'forward';
  @ApiProperty({ enum: ['open', 'received'] }) status: 'open' | 'received';
  @ApiPropertyOptional({ nullable: true, description: '전달용 상자일 때만 — 비고(발송 지시)' }) forwardNote:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true }) receiptId: string | null;
  @ApiProperty({ type: [BoxLineViewDto] }) lines: BoxLineViewDto[];
  @ApiProperty({ type: [BoxCountViewDto], description: '이 상자의 유효 집계(확정된 상자만 있다)' })
  counts: BoxCountViewDto[];
}

export type BoxCandidateView = BoxCandidateViewDto;
export type BoxView = BoxViewDto;
export type ReceiveBoxResult = ReceiveBoxResultDto;
export type CancelBoxReceiptResult = CancelBoxReceiptResultDto;
