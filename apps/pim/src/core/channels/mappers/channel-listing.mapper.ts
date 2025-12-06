import { DateMapper } from '../../../common/mappers';
import {
  ChannelListingDto,
  ChannelListingWithChannelDto,
  ChannelSiteInfoDto,
} from '../dto/channel-listings/channel-listing-response.dto';
import { ChannelVariantListingEntity } from '../../../schema.types';

/**
 * Mapper for ChannelListing DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ChannelListingMapper {
  /**
   * Map entity to ChannelListingDto
   */
  static toDto(entity: ChannelVariantListingEntity): ChannelListingDto {
    return {
      id: entity.id,
      variantId: entity.variantId,
      salesChannelId: entity.salesChannelId,
      channelItemId: entity.channelItemId,
      channelItemName: entity.channelItemName,
      channelOptionName: entity.channelOptionName,
      channelPrice: entity.channelPrice,
      channelProductUrl: entity.channelProductUrl,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map entity to ChannelListingWithChannelDto
   */
  static toWithChannelDto(entity: ChannelVariantListingEntity & { channel?: unknown }): ChannelListingWithChannelDto {
    return {
      id: entity.id,
      channelItemId: entity.channelItemId,
      channelItemName: entity.channelItemName,
      channelOptionName: entity.channelOptionName,
      channelPrice: entity.channelPrice,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      channel: entity.channel,
    };
  }
}
