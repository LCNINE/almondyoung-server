import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsHealthDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({ example: 'analytics' })
  service: string;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  timestamp: string;
}
