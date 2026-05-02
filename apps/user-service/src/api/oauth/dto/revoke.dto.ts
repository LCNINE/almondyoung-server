import { ApiProperty } from '@nestjs/swagger';

/**
 * /oauth/revoke (RFC 7009) 입력. 컨트롤러가 plain body 를 받아 `normalizeRevokeBody` 로 정규화.
 * snake_case 와 camelCase 모두 수용.
 */
export class RevokeRequestDto {
  @ApiProperty({ description: 'client_id' })
  clientId: string;

  @ApiProperty({ required: false, description: 'client_secret' })
  clientSecret?: string;

  @ApiProperty({ description: 'revoke 대상 token (refresh_token)' })
  token: string;
}
