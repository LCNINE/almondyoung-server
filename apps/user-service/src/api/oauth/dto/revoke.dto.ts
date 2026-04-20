import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RevokeRequestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  clientId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  clientSecret: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  token: string;
}
