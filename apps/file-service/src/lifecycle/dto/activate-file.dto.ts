import { IsString, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActivateFileDto {
  @ApiProperty({
    description: 'Type of the related entity',
    example: 'product',
  })
  @IsString()
  relatedType: string;

  @ApiProperty({
    description: 'ID of the related entity',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  @IsUUID()
  relatedId: string;

  @ApiProperty({
    description: 'Optional additional metadata',
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

