import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class Cafe24LinkRequestDto {
  @ApiProperty({
    description: 'Cafe24 front SDK에서 받은 암호화 id 토큰',
    example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9...',
  })
  @IsString({ message: '암호화 id 토큰은 문자열이어야 합니다.' })
  encryptedIdToken: string;
}

export class Cafe24LinkResponseDto {
  @ApiProperty({ description: '연결 ID' })
  linkId: string;

  @ApiProperty({ description: 'Cafe24 몰 ID' })
  mallId: string;

  @ApiProperty({ description: 'Cafe24 회원 ID' })
  cafe24MemberId: string;

  @ApiProperty({ description: '연결 시각' })
  linkedAt: string;
}
