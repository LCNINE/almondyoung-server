import { DateMapper } from '../../../common/mappers';
import { SalesChannelDto } from '../dto/sales-channels/sales-channel-response.dto';
import { SalesChannelEntity } from '../../../schema.types';

/**
 * Mapper for SalesChannel DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class SalesChannelMapper {
  /**
   * Map entity to SalesChannelDto
   */
  static toDto(entity: SalesChannelEntity & { category?: unknown }): SalesChannelDto {
    return {
      id: entity.id,
      type: entity.type,
      site: entity.site,
      categoryId: entity.categoryId,
      category: entity.category,
      name: entity.name,
      description: entity.description,
      config: entity.config,
      isActive: entity.isActive,
      apiEndpoint: entity.apiEndpoint,
      credentials: entity.credentials,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map array of entities to SalesChannelDto array
   */
  static toDtoArray(entities: Array<SalesChannelEntity & { category?: unknown }>): SalesChannelDto[] {
    return entities.map(e => this.toDto(e));
  }
}
