import { DateMapper } from '../../../common/mappers';
import {
  TagGroupResponseDto,
  TagValueResponseDto,
} from '../dto';
import { TagGroupEntity, TagValueEntity } from '../../../schema.types';

/**
 * Mapper for Tag DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class TagMapper {
  /**
   * Map entity to TagGroupResponseDto
   */
  static toGroupDto(entity: TagGroupEntity & { valuesCount?: number }): TagGroupResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      displayOrder: entity.displayOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      valuesCount: entity.valuesCount,
    };
  }

  /**
   * Map entity to TagValueResponseDto
   */
  static toValueDto(entity: TagValueEntity & { groupName?: string }): TagValueResponseDto {
    return {
      id: entity.id,
      groupId: entity.groupId,
      name: entity.name,
      displayOrder: entity.displayOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      groupName: entity.groupName,
    };
  }

  /**
   * Map arrays to DTOs
   */
  static toGroupDtoArray(entities: Array<TagGroupEntity & { valuesCount?: number }>): TagGroupResponseDto[] {
    return entities.map(e => this.toGroupDto(e));
  }

  static toValueDtoArray(entities: Array<TagValueEntity & { groupName?: string }>): TagValueResponseDto[] {
    return entities.map(e => this.toValueDto(e));
  }
}
