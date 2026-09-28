import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SmsGateCategory } from '../utils/sms-body';

export type SmsSendRoute = 'PHONE' | 'NHN';

export class SendSmsGateMessageDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds: string[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiProperty({ enum: ['INFORMATIONAL', 'MARKETING'], description: '정보성 / 광고' })
  @IsIn(['INFORMATIONAL', 'MARKETING'])
  category: SmsGateCategory;

  @ApiPropertyOptional({ description: '비우면 한도가 남은 폰을 자동으로 고른다' })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional({ enum: ['PHONE', 'NHN'], default: 'PHONE', description: 'NHN 이면 전부 대표번호로 보낸다. 광고는 PHONE 만' })
  @IsOptional()
  @IsIn(['PHONE', 'NHN'])
  route?: SmsSendRoute;

  @ApiPropertyOptional({ description: '정보성일 때 폰 한도를 넘는 건은 대표번호(NHN)로 보낸다' })
  @IsOptional()
  @IsBoolean()
  nhnFallback?: boolean;
}
