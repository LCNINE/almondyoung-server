import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min } from 'class-validator';

export class ReserveDto {
  @ApiProperty({ description: '주문처리 아이템 ID' })
  @IsString()
  fulfillmentOrderItemId: string;

  @ApiProperty({ description: '예약할 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
