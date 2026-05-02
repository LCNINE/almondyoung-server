import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class TokenRequestDto {
  @ApiProperty({ enum: ['authorization_code', 'refresh_token'] })
  @IsIn(['authorization_code', 'refresh_token'])
  grantType: 'authorization_code' | 'refresh_token';

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  clientId: string;

  // public client(SPA/모바일)는 client_secret 없이 PKCE만으로 인증.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  clientSecret?: string;

  // authorization_code 그랜트용
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  codeVerifier?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  redirectUri?: string;

  // refresh_token 그랜트용
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}

export class TokenResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  tokenType: 'Bearer';

  @ApiProperty()
  expiresIn: number;

  @ApiProperty({ required: false })
  scope?: string;
}
