import {
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AddressDto } from '../../../commons/dto/address.dto';
import { PartialType } from '@nestjs/mapped-types';

// 기본 회원가입 DTO (공통 필드)
export class BaseSignUpDto extends PartialType(AddressDto) {
  @ApiProperty({
    description: '이메일',
    example: 'user@example.com',
    minLength: 6,
    maxLength: 50,
  })
  @IsString({ message: '이메일은 문자열이어야 합니다.' })
  @MinLength(6, { message: '이메일은 최소 6자 이상이어야 합니다.' })
  @MaxLength(50, { message: '이메일은 최대 50자 이하여야 합니다.' })
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: '이메일 형식이 아닙니다.',
  })
  email: string;

  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동',
    minLength: 2,
    maxLength: 8,
  })
  @IsString({ message: '이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이름은 필수 입력 항목입니다.' })
  @MinLength(2, { message: '이름은 최소 2자 이상이어야 합니다.' })
  @MaxLength(8, { message: '이름은 최대 8자 이하여야 합니다.' })
  username: string;
}

// 일반 회원가입 DTO (비밀번호 필수)
export class LocalSignUpDto extends BaseSignUpDto {
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
}

// 소셜 로그인용 DTO (비밀번호 옵션)
export class SignUpDto extends BaseSignUpDto {
  @ApiProperty({
    description: '비밀번호 (선택)',
    example: 'password123',
    minLength: 8,
    maxLength: 20,
    required: false,
  })
  @IsOptional()
  @IsString({ message: '비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  @MaxLength(20, { message: '비밀번호는 최대 20자 이하여야 합니다.' })
  password?: string;
}
