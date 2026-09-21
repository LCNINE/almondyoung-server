import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SmsGateCategory } from '../utils/sms-body';

export class CreateSmsTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: ['INFORMATIONAL', 'MARKETING'], description: '정보성 / 광고' })
  @IsIn(['INFORMATIONAL', 'MARKETING'])
  category: SmsGateCategory;

  @ApiProperty({ description: '{{이름}} 은 발송 시 회원 이름으로 바뀐다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class UpdateSmsTemplateDto extends PartialType(CreateSmsTemplateDto) {}
