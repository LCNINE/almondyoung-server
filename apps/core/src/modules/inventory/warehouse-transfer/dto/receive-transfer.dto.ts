import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class ReceiveTransferLineDto {
  @ApiProperty({ description: '이동 지시서 라인 ID' })
  @IsUUID()
  transferOrderLineId: string;

  @ApiProperty({ description: '도착 수량', minimum: 0 })
  @IsInt()
  @Min(0)
  receivedQty: number;

  @ApiProperty({ description: '분실 수량', minimum: 0 })
  @IsInt()
  @Min(0)
  lostQty: number;
}

export class ReceiveTransferDto {
  @ApiProperty({ description: '멱등키' })
  @IsString()
  idempotencyKey: string;

  @ApiProperty({ description: '도착 로케이션 ID' })
  @IsUUID()
  toLocationId: string;

  @ApiPropertyOptional({ description: '작업자 ID' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ description: '도착 회차 라인', type: [ReceiveTransferLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferLineDto)
  lines: ReceiveTransferLineDto[];
}
