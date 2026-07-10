import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { userServiceEnums } from 'apps/user-service/database/drizzle/schema';

const EMAIL_PURPOSES = userServiceEnums.emailVerificationPurposeEnum.enumValues;
type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

export class SendEmailCodeDto {
  @ApiPropertyOptional({ enum: EMAIL_PURPOSES, default: 'password_change' })
  @IsOptional()
  @IsIn(EMAIL_PURPOSES)
  purpose?: EmailPurpose = 'password_change';
}

export class VerifyEmailCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiPropertyOptional({ enum: EMAIL_PURPOSES, default: 'password_change' })
  @IsOptional()
  @IsIn(EMAIL_PURPOSES)
  purpose?: EmailPurpose = 'password_change';
}
