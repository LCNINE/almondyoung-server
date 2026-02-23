import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetryReconcileDto {
  @ApiProperty({
    description: 'Retry reason code',
    example: 'MANUAL_RETRY',
  })
  @IsString()
  reasonCode!: string;

  @ApiPropertyOptional({
    description: 'Optional retry reason message',
    example: 'Provider status stabilized, retrying reconcile',
  })
  @IsOptional()
  @IsString()
  reasonMessage?: string;

  @ApiPropertyOptional({
    description: 'Reserved flag for force retry behavior',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
