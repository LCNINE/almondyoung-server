import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({
    description: '이름',
    example: '홍길동',
    minLength: 2,
    maxLength: 8,
  })
  @IsString({ message: '이름은 문자열이어야 합니다.' })
  @MinLength(2, { message: '이름은 최소 2자 이상이어야 합니다.' })
  @MaxLength(8, { message: '이름은 최대 8자 이하여야 합니다.' })
  @IsNotEmpty({ message: '이름은 필수 입력 항목입니다.' })
  username: string;

  @ApiProperty({
    description: '닉네임',
    example: '홍길동',
  })
  @IsString({ message: '닉네임은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '닉네임은 필수 입력 항목입니다.' })
  nickname: string;

  @ApiProperty({
    description: '로그인 ID',
    example: 'user123',
    minLength: 4,
    maxLength: 20,
  })
  @IsString({ message: 'ID는 문자열이어야 합니다.' })
  @Length(4, 20, { message: 'ID는 최소 4자 이상, 최대 20자 이하여야 합니다.' })
  @Matches(/^[a-z0-9]+$/, {
    message: 'ID는 영문 소문자와 숫자만 사용할 수 있습니다.',
  })
  loginId: string;

  @ApiProperty({
    description: '이메일',
    example: 'user@example.com',
  })
  @IsString({ message: '이메일은 문자열이어야 합니다.' })
  @IsEmail({}, { message: '이메일 형식이 아닙니다.' })
  @IsNotEmpty({ message: '이메일은 필수 입력 항목입니다.' })
  email: string;

  @ApiProperty({
    description: '비밀번호 (영문, 숫자, 특수문자 포함 8-20자)',
    example: 'password123!',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({ message: '비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  @MaxLength(20, { message: '비밀번호는 최대 20자 이하여야 합니다.' })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.',
  })
  password: string;

  @ApiProperty({
    description: '역할 ID',
    example: '1',
  })
  @IsString({ message: '역할 ID는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '사용자 등급을 선택해주세요.' })
  roleId: string;

  @ApiProperty({
    description: '전화번호',
    example: '+821012345678',
  })
  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  @IsOptional({ message: '전화번호는 선택적 입력 항목입니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '전화번호는 E.164 형식이어야 합니다. (예: +821012345678)',
  })
  phone_number?: string;
}
