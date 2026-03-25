import { DateMapper } from '../../../common/mappers';
import { SalesChannelDto } from '../dto/sales-channels/sales-channel-response.dto';
import { ChannelCategoryEntity, SalesChannelEntity } from '../../../schema.types';
import { ChannelCategoryMapper } from './channel-category.mapper';

/**
 * Mapper for SalesChannel DTOs
 * Handles Date to ISO 8601 string conversion
 */

export type SalesChannelWithCategory = SalesChannelEntity & {
  category: ChannelCategoryEntity | null;
};

export class SalesChannelMapper {
  /**
   * Map entity to SalesChannelDto
   */
  static toDto(entity: SalesChannelWithCategory): SalesChannelDto {
    return {
      id: entity.id,
      type: entity.type,
      site: entity.site,
      categoryId: entity.categoryId,
      category: entity.category ? ChannelCategoryMapper.toDto(entity.category) : null,
      name: entity.name,
      description: entity.description,
      config: entity.config ?? {},
      isActive: entity.isActive,
      apiEndpoint: entity.apiEndpoint,
      credentials: entity.credentials ?? {},
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map array of entities to SalesChannelDto array
   */
  static toDtoArray(entities: Array<SalesChannelWithCategory>): SalesChannelDto[] {
    return entities.map((e) => this.toDto(e));
  }
}
