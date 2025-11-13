import { PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SendVerificationCodeDto {
  @IsString({ message: '국가 코드는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '국가 코드는 필수 입력 항목입니다.' })
  countryCode: string;

  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '전화번호는 필수 입력 항목입니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '전화번호는 E.164 국제 표준 형식이어야 합니다.',
  })
  phoneNumber: string;
}

export class LookupDto extends PickType(SendVerificationCodeDto, [
  'phoneNumber',
  'countryCode',
] as const) {}
