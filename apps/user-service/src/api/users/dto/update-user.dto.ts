import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from '../../../commons/dto/address.dto';
import { Type } from 'class-transformer';

export const INTEREST_CATEGORY_KEYS = [
  'lash-perm',
  'lash-extension',
  'semi-permanent',
  'nail',
  'tattoo',
  'skincare',
  'hair',
  'waxing',
] as const;
export type InterestCategoryKey = (typeof INTEREST_CATEGORY_KEYS)[number];

export class UpdateUserDto {
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
    example: '+821012345678',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '전화번호는 문자열이어야 합니다.' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: '전화번호는 E.164 형식이어야 합니다. (예: +821012345678)',
  })
  phoneNumber?: string;

  @ApiProperty({
    description: '생년월일',
    example: '19900101',
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

  @ApiProperty({
    description: '주소 정보',
    type: AddressDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto | null;

  @ApiProperty({
    description: '관심 시술 카테고리 키 배열 (최대 3개). 빈 배열은 명시적 초기화로 처리됨.',
    isArray: true,
    enum: INTEREST_CATEGORY_KEYS,
    required: false,
    example: ['nail', 'tattoo'],
  })
  @IsOptional()
  @IsArray({ message: '관심 카테고리는 배열이어야 합니다.' })
  @ArrayMaxSize(3, { message: '관심 카테고리는 최대 3개까지 선택할 수 있습니다.' })
  @IsString({ each: true })
  @IsIn(INTEREST_CATEGORY_KEYS as unknown as string[], {
    each: true,
    message: '허용되지 않는 카테고리 키입니다.',
  })
  interestCategoryKeys?: InterestCategoryKey[];
}
