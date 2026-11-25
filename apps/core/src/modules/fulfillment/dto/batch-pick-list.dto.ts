import { ApiProperty } from '@nestjs/swagger';

export class BatchPickListRowDto {
  @ApiProperty({ description: '송장에 찍히는 것과 같은 위치 코드' })
  locationCode: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  @ApiProperty({ description: '이 위치에서 이 상품을 집을 수량(남은 상자 전부)' })
  qty: number;
  @ApiProperty({ description: '그중 이미 집은 수량' })
  pickedQty: number;
  @ApiProperty({ description: '이 줄이 들어가는 상자 수' })
  boxes: number;
}

export class BatchPickListDto {
  batchId: string;
  batchNumber: string;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: '작업을 시작한 시각. 시작 전이면 배정이 없어 목록이 비어 있다',
  })
  startedAt: Date | null;
  @ApiProperty({ description: '목록에 든 상자 수' })
  boxes: number;
  @ApiProperty({ type: [BatchPickListRowDto] })
  rows: BatchPickListRowDto[];
}
