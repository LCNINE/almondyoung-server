import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: '대상 사용자 로그인 ID',
    example: 'user123',
  })
  @IsString({ message: '로그인 ID는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '로그인 ID는 필수 입력 항목입니다.' })
  loginId: string;

  @ApiProperty({
    description: '새 비밀번호 (영문, 숫자, 특수문자 포함 8-20자)',
    example: 'newPassword123!',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({ message: '비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  @MaxLength(20, { message: '비밀번호는 최대 20자 이하여야 합니다.' })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.',
  })
  newPassword: string;
}
