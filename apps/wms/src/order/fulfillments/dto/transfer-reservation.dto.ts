import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min } from 'class-validator';

export class TransferReservationDto {
  @ApiProperty({ description: '이전할 원본 아이템 ID' })
  @IsString()
  fromFulfillmentOrderItemId: string;

  @ApiProperty({ description: '이전할 대상 아이템 ID' })
  @IsString()
  toFulfillmentOrderItemId: string;

  @ApiProperty({ description: '이전할 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

