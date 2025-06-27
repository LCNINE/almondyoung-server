import {
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: '이메일 형식이 아닙니다.',
  })
  email: string;

  // @IsString()
  // @Length(4, 20)
  // @Matches(/^[a-zA-Z0-9._]+$/, {
  //   message: 'ID는 영문 대소문자, 숫자, ., _ 만 사용할 수 있습니다.',
  // })
  // userId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(8)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  password: string;
}
