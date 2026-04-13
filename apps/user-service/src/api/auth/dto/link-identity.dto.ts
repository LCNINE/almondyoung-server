import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * OAuth State 토큰에 포함되는 페이로드
 */
export interface LinkingStatePayload {
  userId: string;
  nonce: string;
  purpose: 'link';
  iat: number;
  exp: number;
}

export class StartLinkingDto {
  @ApiPropertyOptional({
    description: '연결 완료 후 리다이렉트할 URL',
    example: '/mypage/settings',
  })
  @IsOptional()
  @IsString()
  redirectTo?: string;
}

export class UnlinkIdentityDto {
  @ApiProperty({
    description: '해제할 소셜 프로바이더',
    enum: ['kakao', 'naver'],
    example: 'kakao',
  })
  @IsNotEmpty()
  @IsEnum(['kakao', 'naver'], { message: 'provider는 kakao 또는 naver여야 합니다' })
  provider: 'kakao' | 'naver';
}

export class LinkCallbackQueryDto {
  @ApiProperty({ description: 'OAuth 인증 코드' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'CSRF 방지를 위한 state 토큰' })
  @IsString()
  state: string;
}
