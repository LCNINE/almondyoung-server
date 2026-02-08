import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class Cafe24SignupBootstrapRequestDto {
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

export class Cafe24SignupPrefillDto {
  @ApiProperty({
    description: '이메일 prefill 값',
    nullable: true,
    example: 'user@example.com',
  })
  email: string | null;

  @ApiProperty({
    description: '이름 prefill 값',
    nullable: true,
    example: '홍길동',
  })
  username: string | null;

  @ApiProperty({
    description: '생년월일 prefill 값 (yyyyMMdd)',
    nullable: true,
    example: '19900101',
  })
  birthday: string | null;

  @ApiProperty({
    description: '휴대폰 번호 prefill 값',
    nullable: true,
    example: '+821012345678',
  })
  phoneNumber: string | null;
}

export class Cafe24SignupBootstrapResponseDto {
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

  @ApiProperty({
    description: 'Cafe24 회원 ID',
    nullable: true,
    example: 'member123',
  })
  memberId: string | null;

  @ApiProperty({
    description: 'Cafe24 회원 이름',
    example: '홍길동',
  })
  memberName: string;

  @ApiProperty({
    description: 'privacy prefill 정보를 가져왔는지 여부',
    example: true,
  })
  prefillAvailable: boolean;

  @ApiProperty({
    type: Cafe24SignupPrefillDto,
  })
  prefill: Cafe24SignupPrefillDto;
}
