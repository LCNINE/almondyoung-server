import { DateMapper } from '../../../common/mappers';
import { TopNoticeEntity } from '../../../schema/catalog.schema.types';
import { TopNoticePublicDto, TopNoticeResponseDto } from '../dto/top-notice-response.dto';

export class TopNoticeMapper {
  static toDto(entity: TopNoticeEntity): TopNoticeResponseDto {
    return {
      id: entity.id,
      text: entity.text,
      linkUrl: entity.linkUrl,
      displayStartAt: DateMapper.toNullableString(entity.displayStartAt),
      displayEndAt: DateMapper.toNullableString(entity.displayEndAt),
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  static toDtoArray(entities: TopNoticeEntity[]): TopNoticeResponseDto[] {
    return entities.map((e) => this.toDto(e));
  }

  static toPublicDtoArray(entities: TopNoticeEntity[]): TopNoticePublicDto[] {
    return entities.map((e) => ({ id: e.id, text: e.text, linkUrl: e.linkUrl }));
  }
}
