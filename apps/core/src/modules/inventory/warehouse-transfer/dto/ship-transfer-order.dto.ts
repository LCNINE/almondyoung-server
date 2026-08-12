import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ShipTransferOrderDto {
  @ApiProperty({ description: '멱등키' })
  @IsString()
  idempotencyKey: string;

  @ApiPropertyOptional({ description: '작업자 ID' })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}
