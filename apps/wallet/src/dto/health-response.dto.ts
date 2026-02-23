import { ApiProperty } from '@nestjs/swagger';

export class HealthDataResponseDto {
  @ApiProperty({
    description: 'Health status',
    enum: ['ok', 'ready'],
    example: 'ok',
  })
  status!: 'ok' | 'ready';
}
