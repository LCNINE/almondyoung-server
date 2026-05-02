import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeRequestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  clientId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  clientSecret?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  token: string;
}
