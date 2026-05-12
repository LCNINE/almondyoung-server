import { DateMapper } from '../../../common/mappers';
import { TagGroupResponseDto, TagValueItemDto } from '../dto';
import { TagGroupEntity, TagValueEntity } from '../../../schema/catalog.schema.types';
import { TagValueWithGroupNameDto } from '../dto/tag-value-with-group-name.dto';

export type TagGroupWithValues = TagGroupEntity & {
  values: TagValueEntity[];
};

export class TagMapper {
  static toGroupDto(entity: TagGroupWithValues): TagGroupResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      displayOrder: entity.displayOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      values: entity.values.map((v) => TagMapper.toValueDto(v)),
    };
  }

  static toValueDto(entity: TagValueEntity): TagValueItemDto {
    return {
      id: entity.id,
      groupId: entity.groupId,
      name: entity.name,
      displayOrder: entity.displayOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  static toValueWithGroupDto(entity: TagValueEntity & { group: TagGroupEntity }): TagValueWithGroupNameDto {
    return {
      id: entity.id,
      name: entity.name,
      groupId: entity.groupId,
      groupName: entity.group.name,
      displayOrder: entity.displayOrder,
      isActive: entity.isActive,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }
}
