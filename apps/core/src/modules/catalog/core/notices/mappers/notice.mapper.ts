import { DateMapper } from '../../../common/mappers';
import { NoticeEntity } from '../../../schema/catalog.schema.types';
import { NoticeResponseDto } from '../dto/notice-response.dto';

/**
 * Mapper for Notice DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class NoticeMapper {
  static toDto(entity: NoticeEntity): NoticeResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      content: entity.content,
      category: entity.category,
      badge: entity.badge,
      isPinned: entity.isPinned,
      displayStartAt: DateMapper.toNullableString(entity.displayStartAt),
      displayEndAt: DateMapper.toNullableString(entity.displayEndAt),
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      deletedAt: DateMapper.toNullableString(entity.deletedAt),
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  static toDtoArray(entities: NoticeEntity[]): NoticeResponseDto[] {
    return entities.map((e) => this.toDto(e));
  }
}
