import { ApiProperty, PickType } from '@nestjs/swagger';
import type { userServiceEnums } from 'apps/user-service/database/drizzle/schema';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class SendVerificationCodeDto {
  @ApiProperty({
    description: '국가 코드 (예: KR, US)',
    example: 'KR',
    required: true,
  })
  @IsString({ message: '국가 코드는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '국가 코드는 필수 입력 항목입니다.' })
  countryCode: string;

  @ApiProperty({
    description: 'E.164 국제 표준 형식의 전화번호 (+ 포함)',
    example: '+821012345678',
    required: true,
  })
  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '전화번호는 필수 입력 항목입니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '전화번호는 E.164 국제 표준 형식이어야 합니다.',
  })
  phoneNumber: string;

  @ApiProperty({
    description: '용도 (예: phone_verify, pin_reset)',
    example: 'phone_verify',
    required: false,
  })
  @IsString({ message: '용도는 문자열이어야 합니다.' })
  @IsOptional()
  purpose?: (typeof userServiceEnums.phoneVerificationPurposeEnum.enumValues)[number] = 'phone_verify';

  @ApiProperty({
    description:
      '발송 채널. 생략하면 문자(SMS). 고객이 「인증번호가 오지 않아요」로 카카오톡을 고르면 KAKAO 로 보낸다 — ' +
      '통신사 스팸보관함으로 들어간 문자는 발송 결과가 성공으로 오므로 서버가 실패를 감지할 수 없다.',
    enum: ['SMS', 'KAKAO'],
    example: 'SMS',
    required: false,
  })
  @IsIn(['SMS', 'KAKAO'], { message: '발송 채널은 SMS 또는 KAKAO 여야 합니다.' })
  @IsOptional()
  channel?: 'SMS' | 'KAKAO';
}

export class LookupDto extends PickType(SendVerificationCodeDto, ['phoneNumber', 'countryCode'] as const) {}
