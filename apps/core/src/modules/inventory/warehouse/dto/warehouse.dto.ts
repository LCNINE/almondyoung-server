import { ApiProperty } from '@nestjs/swagger';
import { warehouseTypeEnum } from '../../schema/inventory.schema';

export class WarehouseDto {
  @ApiProperty({ description: '창고 ID' })
  id: string;

  @ApiProperty({ description: '창고 이름' })
  name: string;

  @ApiProperty({ description: '창고 위치', nullable: true })
  location: string | null;

  @ApiProperty({ description: '창고 타입', enum: warehouseTypeEnum.enumValues })
  type: (typeof warehouseTypeEnum.enumValues)[number];

  @ApiProperty({
    description: '창고가 명시적으로 지원하는 V2 피킹 전략. 미설정 창고는 빈 배열.',
    enum: ['discrete', 'aggregate_then_sort', 'pick_to_tote'],
    isArray: true,
  })
  supportedPickingStrategies: Array<'discrete' | 'aggregate_then_sort' | 'pick_to_tote'>;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;
}
