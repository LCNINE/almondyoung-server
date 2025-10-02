import { PartialType } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AddressDto } from '../../../commons/dto/address.dto';

export class UpdateUserDto extends PartialType(AddressDto) {
  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동',
    minLength: 2,
    maxLength: 8,
    required: false,
  })
  @IsString({ message: '이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이름은 필수 입력 항목입니다.' })
  @MinLength(2, { message: '이름은 최소 2자 이상이어야 합니다.' })
  @MaxLength(8, { message: '이름은 최대 8자 이하여야 합니다.' })
  @IsOptional()
  username?: string;

  @ApiProperty({
    description: '사용자 닉네임',
    example: '홍길동',
    minLength: 2,
    maxLength: 8,
    required: false,
  })
  @IsString({ message: '닉네임은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '닉네임은 필수 입력 항목입니다.' })
  @MinLength(2, { message: '닉네임은 최소 2자 이상이어야 합니다.' })
  @MaxLength(8, { message: '닉네임은 최대 8자 이하여야 합니다.' })
  @IsOptional()
  nickname?: string;

  @ApiProperty({
    description: '전화번호',
    example: '010-1234-5678',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  phoneNumber?: string;

  @ApiProperty({
    description: '생년월일',
    example: '1990-01-01',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: '생년월일은 날짜 형식이어야 합니다.' })
  birthDate?: string;

  @ApiProperty({
    description: '프로필 이미지 URL',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '프로필 이미지 URL는 문자열이어야 합니다.' })
  profileImageUrl?: string;
}
