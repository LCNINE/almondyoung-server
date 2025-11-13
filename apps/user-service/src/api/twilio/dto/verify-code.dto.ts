import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyCodeDto {
  @ApiProperty({
    description: '인증번호 (6자리)',
    example: '123456',
    minLength: 6,
    maxLength: 6,
    required: true,
  })
  @IsString({ message: '인증번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '인증번호는 필수 입력 항목입니다.' })
  @Length(6, 6, { message: '인증번호는 6자리여야 합니다.' })
  code: string;

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
}
