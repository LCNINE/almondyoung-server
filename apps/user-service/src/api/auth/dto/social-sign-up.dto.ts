import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SignUpDto } from './sign-up.dto';
import { providerTypeEnum } from '../../../../database/drizzle/schema';

export class SocialSignUpDto extends SignUpDto {
  @IsNotEmpty({ message: 'providerId는 필수 입력 항목입니다.' })
  @IsString({ message: 'providerId는 문자열이어야 합니다.' })
  providerId: string;

  @IsNotEmpty({ message: 'provider는 필수 입력 항목입니다.' })
  @IsEnum(providerTypeEnum.enumValues, {
    message: 'provider는 올바른 값이 아닙니다.',
  })
  provider: (typeof providerTypeEnum.enumValues)[number];

  @IsOptional()
  @IsString({ message: 'phoneNumber는 문자열이어야 합니다.' })
  phoneNumber?: string;

  @IsOptional()
  address?: Record<string, any>;

  @IsOptional()
  birthDate?: Date;

  @IsOptional()
  @IsString({ message: 'profileImageUrl는 문자열이어야 합니다.' })
  profileImageUrl?: string;
}
