import { ApiProperty } from '@nestjs/swagger';
import { fulfillmentModeEnum, sourceTypeEnum } from '../../schema/inventory.schema';
import {
  DeliveryProfileAddressDto,
  DeliveryProfileReturnAddressDto,
  DeliveryProfileSenderDto,
} from './delivery-profile-address.dto';
import type { DeliveryProfileSourceType, FulfillmentMode } from './create-delivery-profile.dto';

export class DeliveryProfileDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: sourceTypeEnum.enumValues }) sourceType: DeliveryProfileSourceType;
  @ApiProperty({ nullable: true }) avgDeliveryDays: number | null;
  @ApiProperty({ type: DeliveryProfileSenderDto }) sender: DeliveryProfileSenderDto;
  @ApiProperty({ type: DeliveryProfileAddressDto }) originAddress: DeliveryProfileAddressDto;
  @ApiProperty({ type: DeliveryProfileReturnAddressDto }) returnAddress: DeliveryProfileReturnAddressDto;
  @ApiProperty({ nullable: true }) carrierAccountRef: string | null;
  @ApiProperty({ enum: fulfillmentModeEnum.enumValues, isArray: true }) supportedFulfillmentModes: FulfillmentMode[];
  @ApiProperty({ required: false, description: '연결된(삭제되지 않은) SKU 수. 목록에서만 채운다' }) skuCount?: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
