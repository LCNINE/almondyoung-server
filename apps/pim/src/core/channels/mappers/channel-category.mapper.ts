import { DateMapper } from '../../../common/mappers';
import { ChannelCategoryDto } from '../dto/channel-categories/channel-category-response.dto';
import { ChannelCategoryEntity } from '../../../schema.types';

/**
 * Mapper for ChannelCategory DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ChannelCategoryMapper {
  /**
   * Map entity to ChannelCategoryDto
   */
  static toDto(entity: ChannelCategoryEntity & { channelCount?: number }): ChannelCategoryDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      displayOrder: entity.displayOrder,
      channelCount: entity.channelCount,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map array of entities to ChannelCategoryDto array
   */
  static toDtoArray(entities: Array<ChannelCategoryEntity & { channelCount?: number }>): ChannelCategoryDto[] {
    return entities.map(e => this.toDto(e));
  }
}

