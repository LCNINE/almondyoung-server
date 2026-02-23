import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WalletSuccessEnvelopeDto {
  @ApiProperty({
    description: 'Request processing result',
    example: true,
  })
  success!: true;

  @ApiProperty({
    description: 'Business error code. Always null for successful responses.',
    nullable: true,
    example: null,
    type: String,
  })
  error!: string | null;

  @ApiProperty({
    description: 'Response timestamp (ISO-8601)',
    format: 'date-time',
    example: '2026-02-22T14:30:00.000Z',
  })
  timestamp!: string;
}

export class WalletErrorResponseDto {
  @ApiProperty({
    description: 'Request processing result',
    example: false,
  })
  success!: false;

  @ApiProperty({
    description: 'Error code',
    example: 'BAD_REQUEST',
  })
  error!: string;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Request validation failed',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'Debug message returned in non-production environments',
    example: 'Bad Request Exception - POST /v1/intents',
  })
  devMessage?: string;

  @ApiPropertyOptional({
    description: 'Stack trace returned in non-production environments',
    example: 'Error: Request validation failed',
  })
  stack?: string;
}
