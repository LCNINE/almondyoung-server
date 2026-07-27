import { ApiProperty } from '@nestjs/swagger';

export class PutawayPendingItemDto {
  @ApiProperty({ description: '입고 라인 ID' })
  lineId: string;

  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 이름', example: '무선마우스 블랙' })
  skuName: string;

  @ApiProperty({ description: 'SKU 코드', example: 'MOUSE-BK-01' })
  skuCode: string;

  @ApiProperty({ description: '미적치 잔량', example: 20 })
  pendingQty: number;

  @ApiProperty({ description: '출발지 로케이션 ID' })
  originLocationId: string;

  @ApiProperty({ description: '출발지 로케이션 코드', example: 'zone-inbound-default' })
  originLocationCode: string;

  @ApiProperty({ description: '입고 시각 (ISO)', example: '2026-07-26T00:14:00.000Z' })
  receivedAt: string;
}

export class PutawayPendingListDto {
  @ApiProperty({ description: '반환된 건수 (LIMIT 이 걸리면 실제 백로그보다 작을 수 있다 — truncated 로 확인)', example: 2 })
  total: number;

  @ApiProperty({ description: 'LIMIT(200)에 걸려 잘렸는지 여부. true 면 백로그가 더 있다.', example: false })
  truncated: boolean;

  @ApiProperty({ description: '적치 대기 라인', type: [PutawayPendingItemDto] })
  items: PutawayPendingItemDto[];
}
