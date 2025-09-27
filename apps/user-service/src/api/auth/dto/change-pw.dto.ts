import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    description: '새 비밀번호',
    example: 'newpassword123',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({
    message: '비밀번호는 문자열이어야 합니다.',
  })
  @MinLength(8, {
    message: '비밀번호는 최소 8자 이상이어야 합니다.',
  })
  @MaxLength(20, {
    message: '비밀번호는 최대 20자 이하이어야 합니다.',
  })
  password: string;
}
