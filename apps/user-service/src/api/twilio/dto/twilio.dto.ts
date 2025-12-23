import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

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
  purpose?: string = 'phone_verify';
}

export class LookupDto extends PickType(SendVerificationCodeDto, [
  'phoneNumber',
  'countryCode',
] as const) { }
