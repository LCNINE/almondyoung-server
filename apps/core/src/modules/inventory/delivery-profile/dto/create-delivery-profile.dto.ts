import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { fulfillmentModeEnum, sourceTypeEnum } from '../../schema/inventory.schema';
import {
  DeliveryProfileAddressDto,
  DeliveryProfileReturnAddressDto,
  DeliveryProfileSenderDto,
  NOT_BLANK,
} from './delivery-profile-address.dto';

export type DeliveryProfileSourceType = (typeof sourceTypeEnum.enumValues)[number];
export type FulfillmentMode = (typeof fulfillmentModeEnum.enumValues)[number];

/**
 * 생성은 «완전한» 프로필만 받는다 — 계획 확정(assertPlanProfile)·배치 편입(assertProfileComplete)이
 * 요구하는 필드를 전부 필수로 둔다. 불완전한 프로필은 만들어 봐야 계획 확정에서 다시 막힌다.
 */
export class CreateDeliveryProfileDto {
  @ApiProperty({ description: '프로필 이름' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: '원천 유형', enum: sourceTypeEnum.enumValues })
  @IsIn(sourceTypeEnum.enumValues)
  sourceType: DeliveryProfileSourceType;

  @ApiProperty({ description: '평균 배송일', required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  avgDeliveryDays?: number;

  @ApiProperty({ description: '발송인', type: DeliveryProfileSenderDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileSenderDto)
  sender: DeliveryProfileSenderDto;

  @ApiProperty({ description: '출고지', type: DeliveryProfileAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileAddressDto)
  originAddress: DeliveryProfileAddressDto;

  @ApiProperty({ description: '반품지', type: DeliveryProfileReturnAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryProfileReturnAddressDto)
  returnAddress: DeliveryProfileReturnAddressDto;

  @ApiProperty({ description: '택배 계약번호(carrier_account_ref)' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(255)
  carrierAccountRef: string;

  @ApiProperty({ description: '지원 이행 방식', enum: fulfillmentModeEnum.enumValues, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(fulfillmentModeEnum.enumValues, { each: true })
  supportedFulfillmentModes: FulfillmentMode[];
}
