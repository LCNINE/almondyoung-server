import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyCodeDto {
  @IsString({ message: '인증번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '인증번호는 필수 입력 항목입니다.' })
  @Length(6, 6, { message: '인증번호는 6자리여야 합니다.' })
  code: string;

  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '전화번호는 필수 입력 항목입니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '전화번호는 E.164 국제 표준 형식이어야 합니다.',
  })
  phoneNumber: string;
}
