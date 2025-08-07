import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SignUpDto } from './sign-up.dto';
import { providerTypeEnum } from '../../../../database/drizzle/schema';

export class SocialSignUpDto extends SignUpDto {
  @ApiProperty({
    description: '소셜 로그인 제공자 ID',
    example: '12345678',
  })
  @IsNotEmpty({ message: 'providerId는 필수 입력 항목입니다.' })
  @IsString({ message: 'providerId는 문자열이어야 합니다.' })
  providerId: string;

  @ApiProperty({
    description: '소셜 로그인 제공자',
    enum: providerTypeEnum.enumValues,
    example: 'kakao',
  })
  @IsNotEmpty({ message: 'provider는 필수 입력 항목입니다.' })
  @IsEnum(providerTypeEnum.enumValues, {
    message: 'provider는 올바른 값이 아닙니다.',
  })
  provider: (typeof providerTypeEnum.enumValues)[number];

  @ApiProperty({
    description: '전화번호',
    example: '010-1234-5678',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'phoneNumber는 문자열이어야 합니다.' })
  phoneNumber?: string;

  @ApiProperty({
    description: '주소 정보',
    example: { street: '테헤란로', city: '서울' },
    required: false,
  })
  @IsOptional()
  address?: Record<string, any>;

  @ApiProperty({
    description: '생년월일',
    example: '1990-01-01',
    required: false,
  })
  @IsOptional()
  birthDate?: Date;

  @ApiProperty({
    description: '프로필 이미지 URL',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'profileImageUrl는 문자열이어야 합니다.' })
  profileImageUrl?: string;
}
