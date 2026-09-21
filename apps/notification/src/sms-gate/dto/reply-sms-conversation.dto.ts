import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReplySmsConversationDto {
  @ApiProperty({ example: '+821012345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: '받은 폰의 한도를 넘으면 대표번호(NHN)로 보낸다' })
  @IsOptional()
  @IsBoolean()
  nhnFallback?: boolean;
}
