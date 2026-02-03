import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class IssueCafe24LinkTokenDto {
  @ApiProperty({
    description: 'Cafe24 front SDK에서 받은 암호화 id 토큰',
    example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9...',
  })
  @IsString({ message: '암호화 id 토큰은 문자열이어야 합니다.' })
  encryptedIdToken: string;

  @ApiProperty({
    description: 'Cafe24 몰 ID',
    required: false,
    example: 'almondyoung',
  })
  @IsOptional()
  @IsString({ message: '몰 ID는 문자열이어야 합니다.' })
  mallId?: string;
}

export class IssueCafe24LinkTokenResponseDto {
  @ApiProperty({
    description: '1회용 cafe24_link_token',
    example: 'cafe24_link_token_value',
  })
  cafe24LinkToken: string;

  @ApiProperty({
    description: '토큰 만료 시각 (ISO 8601)',
    example: '2026-02-03T12:00:00.000Z',
  })
  expiresAt: string;
}
