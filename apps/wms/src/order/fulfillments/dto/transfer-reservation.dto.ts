import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min } from 'class-validator';

export class TransferReservationDto {
  @ApiProperty({ description: '이전할 원본 라인 ID' })
  @IsString()
  fromFulfillmentOrderLineId: string;

  @ApiProperty({ description: '이전할 대상 라인 ID' })
  @IsString()
  toFulfillmentOrderLineId: string;

  @ApiProperty({ description: '이전할 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

