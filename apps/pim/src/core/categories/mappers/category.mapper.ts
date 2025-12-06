import { DateMapper } from '../../../common/mappers';
import { CategoryResponseDto } from '../dto/category-response.dto';
import { CategoryEntity } from '../../../schema.types';

/**
 * Mapper for Category DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class CategoryMapper {
  /**
   * Map entity to CategoryResponseDto
   */
  static toDto(entity: CategoryEntity & {
    childCount?: number;
    productCount?: number;
    thumbnail?: string | null;
  }): CategoryResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      slug: entity.slug,
      parentId: entity.parentId,
      level: entity.level,
      path: entity.path,
      sortOrder: entity.sortOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      childCount: entity.childCount,
      productCount: entity.productCount,
      thumbnail: entity.thumbnail,
    };
  }

  /**
   * Map array of entities to CategoryResponseDto array
   */
  static toDtoArray(entities: Array<CategoryEntity & {
    childCount?: number;
    productCount?: number;
    thumbnail?: string | null;
  }>): CategoryResponseDto[] {
    return entities.map(e => this.toDto(e));
  }
}
