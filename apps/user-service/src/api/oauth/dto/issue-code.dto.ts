import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

export class IssueCodeRequestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  clientId: string;

  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  redirectUri: string;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  codeChallenge: string;

  @ApiProperty({ enum: ['S256'] })
  @IsIn(['S256'])
  codeChallengeMethod: 'S256';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  scope?: string;
}

export class IssueCodeResponseDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  expiresIn: number;
}
