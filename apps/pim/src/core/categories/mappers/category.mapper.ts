import { DateMapper } from '../../../common/mappers';
import { CategoryResponseDto } from '../dto/category-response.dto';
import { CategoryTagGroupsResponseDto } from '../dto/category-tag-groups-response.dto';
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

  /**
   * Map category tag groups entity to DTO
   * Converts Date to ISO string for API response
   */
  static toCategoryTagGroupsDto(
    entity: CategoryTagGroupsEntity
  ): CategoryTagGroupsResponseDto {
    return {
      categoryId: entity.categoryId,
      categoryName: entity.categoryName,
      tagGroups: entity.tagGroups.map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
        displayOrder: group.displayOrder,
        isRequired: group.isRequired,
        appliesToDescendants: group.appliesToDescendants,
        isInherited: group.isInherited,
        inheritedFromCategoryId: group.inheritedFromCategoryId,
        inheritedFromCategoryName: group.inheritedFromCategoryName,
        isActive: group.isActive,
        values: group.values.map(value => ({
          id: value.id,
          groupId: value.groupId,
          name: value.name,
          displayOrder: value.displayOrder,
          isActive: value.isActive,
          createdAt: DateMapper.toNotNullString(value.createdAt),
          updatedAt: DateMapper.toNotNullString(value.updatedAt),
        })),
      })),
    };
  }
}

/**
 * Service layer internal types (Date types maintained)
 */
export type CategoryTagValueItem = {
  id: string;
  groupId: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryTagGroupItem = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isRequired: boolean;
  appliesToDescendants: boolean;
  isInherited: boolean;
  inheritedFromCategoryId?: string | null;
  inheritedFromCategoryName?: string | null;
  isActive: boolean;
  values: CategoryTagValueItem[];
};

export type CategoryTagGroupsEntity = {
  categoryId: string;
  categoryName: string;
  tagGroups: CategoryTagGroupItem[];
};
