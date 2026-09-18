import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WithdrawMarketingConsentRequestDto {
  @ApiProperty({ example: '+821012345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ example: 'sms-reply' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  via: string;
}
