import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: '휴대폰 번호',
    example: '010-1234-5678',
  })
  @IsString({ message: '휴대폰 번호는 문자열이어야 합니다.' })
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
