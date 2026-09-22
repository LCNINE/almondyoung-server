import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { SmsSendRoute } from './send-sms-gate-message.dto';

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

  @ApiPropertyOptional({ description: '답장을 보낼 발송폰. 없으면 마지막으로 받은 폰' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;

  @ApiPropertyOptional({ enum: ['PHONE', 'NHN'], default: 'PHONE' })
  @IsOptional()
  @IsIn(['PHONE', 'NHN'])
  route?: SmsSendRoute;

  @ApiPropertyOptional({ description: '받은 폰의 한도를 넘으면 대표번호(NHN)로 보낸다' })
  @IsOptional()
  @IsBoolean()
  nhnFallback?: boolean;
}
