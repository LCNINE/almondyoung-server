import { DateMapper } from '../../../common/mappers';
import { SitePopupEntity } from '../../../schema/catalog.schema.types';
import { SitePopupResponseDto } from '../dto/site-popup-response.dto';
import {
  SitePopupAudience,
  SitePopupContentType,
  SitePopupDismissMode,
  SitePopupPlacement,
} from '../site-popup.constants';

export class SitePopupMapper {
  static toDto(entity: SitePopupEntity): SitePopupResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      contentType: entity.contentType as SitePopupContentType,
      content: entity.content,
      pcImageFileId: entity.pcImageFileId,
      mobileImageFileId: entity.mobileImageFileId,
      imageAlt: entity.imageAlt,
      linkUrl: entity.linkUrl,
      noticeId: entity.noticeId,
      pcWidth: entity.pcWidth,
      pcHeight: entity.pcHeight,
      mobileWidth: entity.mobileWidth,
      mobileHeight: entity.mobileHeight,
      placement: entity.placement as SitePopupPlacement,
      placementPaths: entity.placementPaths ?? [],
      audience: entity.audience as SitePopupAudience,
      dismissMode: entity.dismissMode as SitePopupDismissMode,
      dismissDays: entity.dismissDays,
      dismissVersion: entity.dismissVersion,
      displayStartAt: DateMapper.toNullableString(entity.displayStartAt),
      displayEndAt: DateMapper.toNullableString(entity.displayEndAt),
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      deletedAt: DateMapper.toNullableString(entity.deletedAt),
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  static toDtoArray(entities: SitePopupEntity[]): SitePopupResponseDto[] {
    return entities.map((e) => this.toDto(e));
  }
}
