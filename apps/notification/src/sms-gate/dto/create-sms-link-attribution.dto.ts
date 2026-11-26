import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SMS_LINK_ATTRIBUTION_KINDS, SmsLinkAttributionKind } from '../constants/sms-link-attribution';

export class CreateSmsLinkAttributionDto {
  @ApiProperty({ enum: SMS_LINK_ATTRIBUTION_KINDS })
  @IsIn(SMS_LINK_ATTRIBUTION_KINDS)
  kind!: SmsLinkAttributionKind;
}
