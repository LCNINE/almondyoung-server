import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsUUID, MaxLength, Min } from 'class-validator';

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

  @ApiProperty({ description: '예약 이전 사유', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ description: '연결된 CS case ID', required: false })
  @IsOptional()
  @IsUUID()
  csCaseId?: string;

  @ApiProperty({ description: '운영자 메모', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
