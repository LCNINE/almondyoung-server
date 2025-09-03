// shared/dtos/payments/create-session.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CreateSessionResponseDto {
  @ApiProperty({ example: 'ps_session_xyz789' })
  sessionId!: string;

  @ApiProperty({ example: 'user_123' })
  userId!: string;

  @ApiProperty({ example: 100000 })
  amount!: number;

  @ApiProperty({ example: 'KRW' })
  currency!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ example: '2024-01-15T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    example: {
      url: 'http://localhost:3000/checkout-v2.html?sessionId=ps_session_xyz789&returnUrl=http://localhost:3000/redirect.html',
      phase: 'CHECKOUT',
    },
  })
  checkout!: {
    url: string;
    phase: string;
  };
}
