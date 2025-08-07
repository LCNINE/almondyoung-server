import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignInDto {
  @ApiProperty({
    description: '로그인 ID',
    example: 'user123',
    minLength: 4,
    maxLength: 20,
  })
  @IsString({ message: 'ID는 문자열이어야 합니다.' })
  @Length(4, 20, { message: 'ID는 최소 4자 이상, 최대 20자 이하여야 합니다.' })
  @Matches(/^[a-zA-Z0-9._]+$/, {
    message: 'ID는 영문 대소문자, 숫자, ., _ 만 사용할 수 있습니다.',
  })
  loginId: string;

  @ApiProperty({
    description: '비밀번호',
    example: 'password123',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({ message: '비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  @MaxLength(20, { message: '비밀번호는 최대 20자 이하여야 합니다.' })
  password: string;

  @ApiProperty({
    description: '로그인 상태 유지 여부',
    example: true,
    required: false,
  })
  @IsBoolean({ message: '기억하기 여부는 불리언 값이어야 합니다.' })
  @IsOptional({ message: '기억하기 여부는 선택적 입력 항목입니다.' })
  rememberMe?: boolean;
}
