import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { IConsent } from '../types/consent.type';

export class CreateConsentDto implements IConsent {
  @ApiProperty({
    description: '만 14세 이상 여부',
    example: true,
    required: true,
  })
  @IsBoolean()
  isOver14: boolean;

  @ApiProperty({
    description: '서비스 이용약관 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  termsOfService: boolean;

  @ApiProperty({
    description: '전자금융거래 이용약관 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  electronicTransaction: boolean;

  @ApiProperty({
    description: '개인정보 수집 및 이용 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  privacyPolicy: boolean;

  @ApiProperty({
    description: '개인정보 제3자 제공 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  thirdPartySharing: boolean;

  @ApiProperty({
    description: '이메일 수신 동의',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean()
  emailConsent?: boolean;

  @ApiProperty({
    description: 'SMS 수신 동의',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean()
  smsConsent?: boolean;

  @ApiProperty({
    description: '앱 푸시 알림 수신 동의',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean()
  pushConsent?: boolean;
}
