import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AddressDto } from '../../../commons/dto/address.dto';
import { IConsent } from '../../consents/types/consent.type';

// 기본 회원가입 DTO (공통 필드)
export class BaseSignUpDto extends PartialType(AddressDto) implements IConsent {
  @ApiProperty({
    description: '만 14세 이상 여부',
    example: true,
    required: true,
  })
  @IsBoolean()
  isOver14: boolean;

  @ApiProperty({
    description: '서비스 이용약관 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  termsOfService: boolean;

  @ApiProperty({
    description: '전자금융거래 이용약관 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  electronicTransaction: boolean;

  @ApiProperty({
    description: '개인정보 수집 및 이용 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  privacyPolicy: boolean;

  @ApiProperty({
    description: '개인정보 제3자 제공 동의',
    example: true,
    required: true,
  })
  @IsBoolean()
  thirdPartySharing: boolean;

  @ApiProperty({
    description: '마케팅 수신 동의 (모든 채널)',
    example: false,
    required: true,
  })
  @IsBoolean()
  marketingConsent: boolean;

  @ApiProperty({
    description: '이메일',
    example: 'user@example.com',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: '로그인 ID',
    example: 'user123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Length(3, 50)
  loginId: string;

  @ApiProperty({
    description: '사용자명',
    example: '홍길동',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 50)
  username: string;

  @ApiProperty({
    description: '닉네임',
    example: '닉네임',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 20)
  nickname: string;

  @ApiProperty({
    description: '비밀번호',
    example: 'password123!',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: '비밀번호는 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다.',
  })
  password: string;
}

// 일반 회원가입 DTO
export class UserSignUpDto extends BaseSignUpDto {}

// 도매회원 가입 DTO
export class WholesaleSignUpDto extends BaseSignUpDto {
  @ApiProperty({
    description: '사업자등록번호',
    example: '123-45-67890',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}-\d{2}-\d{5}$/, {
    message: '사업자등록번호는 000-00-00000 형식이어야 합니다.',
  })
  businessNumber: string;

  @ApiProperty({
    description: '사업자명',
    example: '알몬드영 주식회사',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  businessName: string;

  @ApiProperty({
    description: '사업자 유형',
    example: '주식회사',
    required: false,
  })
  @IsString()
  @IsOptional()
  businessType?: string;

  @ApiProperty({
    description: '사업자 업종',
    example: '도소매업',
    required: false,
  })
  @IsString()
  @IsOptional()
  businessCategory?: string;

  @ApiProperty({
    description: '대표자명',
    example: '홍길동',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 50)
  representativeName: string;

  @ApiProperty({
    description: '사업장 주소',
    example: '서울특별시 강남구 테헤란로 123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  businessAddress: string;

  @ApiProperty({
    description: '사업장 전화번호',
    example: '02-1234-5678',
    required: false,
  })
  @IsString()
  @IsOptional()
  businessPhone?: string;
}
