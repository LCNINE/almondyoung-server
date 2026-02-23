import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    description: '현재 비밀번호',
    example: 'currentpassword123',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({
    message: '현재 비밀번호는 문자열이어야 합니다.',
  })
  @MinLength(8, {
    message: '현재 비밀번호는 최소 8자 이상이어야 합니다.',
  })
  @MaxLength(20, {
    message: '현재 비밀번호는 최대 20자 이하이어야 합니다.',
  })
  currentPassword: string;

  @ApiProperty({
    description: '새 비밀번호 (영문, 숫자, 특수문자 포함 8-20자)',
    example: 'newpassword123!',
    minLength: 8,
    maxLength: 20,
  })
  @IsString({
    message: '새 비밀번호는 문자열이어야 합니다.',
  })
  @MinLength(8, {
    message: '새 비밀번호는 최소 8자 이상이어야 합니다.',
  })
  @MaxLength(20, {
    message: '새 비밀번호는 최대 20자 이하이어야 합니다.',
  })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.',
  })
  newPassword: string;
}
