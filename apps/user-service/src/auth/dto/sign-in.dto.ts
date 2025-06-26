import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignInDto {
  @IsString()
  @Length(4, 20)
  @Matches(/^[a-zA-Z0-9._]+$/, {
    message: 'ID는 영문 대소문자, 숫자, ., _ 만 사용할 수 있습니다.',
  })
  userId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  password: string;
}
