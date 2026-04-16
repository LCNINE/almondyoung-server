import { DateMapper } from '../../../common/mappers';
import {
  ChannelProductDto,
  ChannelProductWithChannelDto,
  ChannelProductWithMasterDto,
} from '../dto/channel-products/channel-product-response.dto';
import { ChannelProductEntity, SalesChannelEntity } from '../../../schema/catalog.schema.types';
import { SalesChannelMapper } from './sales-channel.mapper';

/**
 * Mapper for ChannelProduct DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ChannelProductMapper {
  /**
   * Map entity to ChannelProductDto
   */
  static toDto(entity: ChannelProductEntity): ChannelProductDto {
    return {
      id: entity.id,
      masterId: entity.masterId,
      channelId: entity.channelId,
      name: entity.name,
      isActive: entity.isActive ?? false,
      channelSpecificData: entity.channelSpecificData,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map entity to ChannelProductWithChannelDto
   */
  static toWithChannelDto(
    entity: ChannelProductEntity & { channel: SalesChannelEntity },
  ): ChannelProductWithChannelDto {
    return {
      id: entity.id,
      masterId: entity.masterId,
      channelId: entity.channelId,
      name: entity.name,
      isActive: entity.isActive ?? false,
      channelSpecificData: entity.channelSpecificData ?? {},
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      channel: SalesChannelMapper.toDto({ ...entity.channel, category: null }),
    };
  }

  /**
   * Map entity to ChannelProductWithMasterDto
   */
  // static toWithMasterDto(entity: ChannelProductEntity & { description?: string | null; images?: unknown; master?: unknown }): ChannelProductWithMasterDto {
  //   return {
  //     id: entity.id,
  //     masterId: entity.masterId,
  //     channelId: entity.channelId,
  //     name: entity.name,
  //     description: entity.description,
  //     images: entity.images,
  //     isActive: entity.isActive ?? false,
  //     channelSpecificData: entity.channelSpecificData,
  //     createdAt: DateMapper.toNotNullString(entity.createdAt),
  //     updatedAt: DateMapper.toNotNullString(entity.updatedAt),
  //     master: entity.master,
  //   };
  // }
}
