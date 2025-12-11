import { ApiProperty } from '@nestjs/swagger';

export class SkuLocationMovementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  barcode: string;

  @ApiProperty()
  fromLocationId: string;

  @ApiProperty()
  toLocationId: string;

  @ApiProperty({ required: false })
  quantity?: number | null

  @ApiProperty({ required: false })
  reason?: string;

  @ApiProperty({ default: 'completed' })
  status: string;

  @ApiProperty({ required: false })
  movedBy?: string;

  @ApiProperty()
  movementTimestamp: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

