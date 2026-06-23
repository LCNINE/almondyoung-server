import { ApiProperty } from '@nestjs/swagger';

/**
 * /oauth/token 입력. RFC 6749 §4.1.3 / §6.
 * 컨트롤러는 raw plain object 를 받아 `normalizeTokenBody` 로 검증/정규화한 뒤 이 타입을 사용한다.
 * snake_case(표준) 와 camelCase(레거시 내부 호출) 키 양쪽이 수용된다.
 */
export class TokenRequestDto {
  @ApiProperty({ enum: ['authorization_code', 'refresh_token', 'payment_handoff'], description: 'grant_type' })
  grantType: 'authorization_code' | 'refresh_token' | 'payment_handoff';

  @ApiProperty({ description: 'client_id' })
  clientId: string;

  @ApiProperty({ required: false, description: 'client_secret (public client 는 생략, PKCE 로 대체)' })
  clientSecret?: string;

  @ApiProperty({ required: false, description: 'authorization_code 그랜트용 code' })
  code?: string;

  @ApiProperty({ required: false, description: 'code_verifier (PKCE)' })
  codeVerifier?: string;

  @ApiProperty({ required: false, description: 'redirect_uri (등록된 값과 정확 일치)' })
  redirectUri?: string;

  @ApiProperty({ required: false, description: 'refresh_token 그랜트용 토큰' })
  refreshToken?: string;
}

/**
 * RFC 6749 §5.1 표준 응답. 평면 snake_case 객체.
 * `OAuthController` 의 `@SkipResponseEnvelope()` 로 envelope 우회.
 */
export class TokenResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty()
  refresh_token: string;

  @ApiProperty()
  token_type: 'Bearer';

  @ApiProperty()
  expires_in: number;

  @ApiProperty({ required: false })
  scope?: string;

  @ApiProperty({
    required: false,
    description: 'OIDC ID Token (RS256 JWT). scope 에 `openid` 가 포함된 authorization_code 그랜트에서만 발급.',
  })
  id_token?: string;
}
