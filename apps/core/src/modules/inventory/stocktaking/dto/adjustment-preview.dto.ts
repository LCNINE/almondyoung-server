import { ApiProperty } from '@nestjs/swagger';

export class AdjustmentPreviewItem {
  @ApiProperty() lineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty({ type: String, nullable: true }) locationId: string | null;
  @ApiProperty() countedQuantity: number;
  @ApiProperty() currentOnHand: number;
  @ApiProperty({ description: '적용 예정 delta (counted − 현재 ON_HAND)' }) delta: number;
  @ApiProperty({ enum: ['INCREASE', 'DECREASE'] }) adjustmentType: 'INCREASE' | 'DECREASE';
}
