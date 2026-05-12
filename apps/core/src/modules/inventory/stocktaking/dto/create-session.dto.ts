import { IsNotEmpty, IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStocktakingSessionDto {
  @ApiProperty({ description: 'Warehouse ID where stocktaking will be performed' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: 'Session name', example: '2025-10 Cycle Count - Warehouse A' })
  @IsString()
  @IsNotEmpty()
  sessionName: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
