import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SmsGateCategory } from '../utils/sms-body';

export class CreateSmsCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: ['INFORMATIONAL', 'MARKETING'], description: '정보성 / 광고' })
  @IsIn(['INFORMATIONAL', 'MARKETING'])
  category: SmsGateCategory;

  @ApiProperty({ description: '{{이름}} 은 발송 시 회원 이름으로 바뀐다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: '예약 발송 시각. 비우면 바로 시작' })
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}

export class PreviewSmsCampaignDto extends PickType(CreateSmsCampaignDto, ['category', 'sendAt'] as const) {}
