import { ApiProperty } from '@nestjs/swagger';

/**
 * 연결된 소셜 계정 정보 DTO
 */
export class LinkedIdentityDto {
  @ApiProperty({
    description: '소셜 프로바이더',
    enum: ['kakao', 'naver', 'google'],
    example: 'kakao',
  })
  provider: 'kakao' | 'naver' | 'google';

  @ApiProperty({
    description: '프로바이더에서의 사용자 ID',
    example: '123456789',
  })
  providerId: string;

  @ApiProperty({
    description: '연결된 날짜',
    example: '2024-01-15T10:30:00Z',
  })
  linkedAt: Date;

  @ApiProperty({
    description: '프로바이더에서 제공한 이메일 (있는 경우)',
    example: 'user@example.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: '프로바이더에서 제공한 이름 (있는 경우)',
    example: '홍길동',
    required: false,
  })
  name?: string;
}

/**
 * 연결된 소셜 계정 목록 응답 DTO
 */
export class LinkedIdentitiesResponseDto {
  @ApiProperty({
    description: '연결된 소셜 계정 목록',
    type: [LinkedIdentityDto],
  })
  identities: LinkedIdentityDto[];

  @ApiProperty({
    description: '로컬 비밀번호 설정 여부',
    example: true,
  })
  hasPassword: boolean;

  @ApiProperty({
    description: '연결 가능한 소셜 프로바이더 목록',
    example: ['naver'],
  })
  availableProviders: string[];
}

/**
 * 소셜 계정 연결/해제 결과 응답 DTO
 */
export class LinkIdentityResultDto {
  @ApiProperty({
    description: '성공 여부',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: '결과 메시지',
    example: '카카오 계정이 연결되었습니다.',
  })
  message: string;

  @ApiProperty({
    description: '연결된 프로바이더',
    enum: ['kakao', 'naver'],
    example: 'kakao',
    required: false,
  })
  provider?: 'kakao' | 'naver';
}
