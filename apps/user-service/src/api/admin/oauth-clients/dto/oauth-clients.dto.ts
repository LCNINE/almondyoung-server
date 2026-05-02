import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export type OAuthClientType = 'confidential' | 'public';

export class CreateOAuthClientDto {
  @ApiProperty({ description: 'OAuth client_id (영숫자/하이픈/언더스코어)', example: 'daview' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_\-:]+$/, { message: 'clientId 는 영숫자/_/-/: 만 허용' })
  clientId: string;

  @ApiProperty({
    description: 'client type. confidential=server BFF(secret 사용), public=SPA/모바일(PKCE only).',
    enum: ['confidential', 'public'],
    default: 'confidential',
    required: false,
  })
  @IsOptional()
  @IsIn(['confidential', 'public'])
  clientType?: OAuthClientType;

  @ApiProperty({ description: '허용 redirect_uri 목록', example: ['https://daview.com/auth/callback'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({ require_protocol: true, require_tld: false }, { each: true })
  redirectUris: string[];

  @ApiProperty({
    description: 'OIDC RP-Initiated Logout 후 redirect 허용 URI 목록(선택). 등록되지 않은 URI는 logout 시 default로 fallback.',
    required: false,
    example: ['https://daview.com/'],
  })
  @IsArray()
  @IsOptional()
  @IsUrl({ require_protocol: true, require_tld: false }, { each: true })
  postLogoutRedirectUris?: string[];

  @ApiProperty({ description: '허용 스코프 목록(선택)', required: false, example: ['profile', 'email'] })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  allowedScopes?: string[];
}

export class UpdateOAuthClientDto {
  @ApiProperty({ description: '허용 redirect_uri 목록', required: false })
  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @IsUrl({ require_protocol: true, require_tld: false }, { each: true })
  redirectUris?: string[];

  @ApiProperty({ description: 'logout 후 redirect 허용 URI 목록(빈 배열 = null)', required: false })
  @IsArray()
  @IsOptional()
  @IsUrl({ require_protocol: true, require_tld: false }, { each: true })
  postLogoutRedirectUris?: string[];

  @ApiProperty({ description: '허용 스코프 목록(선택, null 로 비우려면 빈 배열 전송)', required: false })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  allowedScopes?: string[];

  @ApiProperty({ description: '활성화 여부', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class OAuthClientResponseDto {
  clientId: string;
  clientType: OAuthClientType;
  redirectUris: string[];
  postLogoutRedirectUris: string[] | null;
  allowedScopes: string[] | null;
  isActive: boolean;
  hasPreviousSecret: boolean;
  secretRotatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OAuthClientWithSecretResponseDto extends OAuthClientResponseDto {
  /** 생성/회전 직후 1회만 평문으로 노출. public client는 null. */
  clientSecret: string | null;
}
