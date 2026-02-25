import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: '휴대폰 번호',
    example: '+821012345678',
  })
  @IsString({ message: '휴대폰 번호는 문자열이어야 합니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '휴대폰 번호는 E.164 형식이어야 합니다. (예: +821012345678)',
  })
  phoneNumber: string;

  @ApiProperty({
    description: '로그인 ID',
    example: 'user123',
    minLength: 4,
    maxLength: 20,
  })
  @IsString({ message: 'ID는 문자열이어야 합니다.' })
  loginId: string;
}
