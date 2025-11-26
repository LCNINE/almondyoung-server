import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNumber, IsUrl, MaxLength } from 'class-validator';

export class CreateChannelListingDto {
  @ApiProperty({ description: 'PIM Variant ID (UUID)' })
  @IsUUID()
  variantId: string;

  @ApiProperty({ description: '판매 채널 ID (UUID)' })
  @IsUUID()
  salesChannelId: string;

  @ApiProperty({
    description: '채널에서의 상품 ID',
    example: 'vendorItemId: 12345 (쿠팡) 또는 productOrderId: ABC-123 (네이버)',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  channelItemId: string;

  @ApiProperty({
    description: '채널에서의 상품명',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  channelItemName?: string;

  @ApiProperty({
    description: '채널에서의 옵션명 (예: "블랙 / M")',
    required: false,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  channelOptionName?: string;

  @ApiProperty({
    description: '채널에서의 판매가 (원)',
    required: false,
    example: 29000,
  })
  @IsOptional()
  @IsNumber()
  channelPrice?: number;

  @ApiProperty({
    description: '채널 상품 URL',
    required: false,
    maxLength: 1000,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  channelProductUrl?: string;
}

