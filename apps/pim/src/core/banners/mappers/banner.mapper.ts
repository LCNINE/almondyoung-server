import { DateMapper } from '../../../common/mappers';
import { BannerResponseDto } from '../dto/banners/banner-response.dto';
import { BannerGroupResponseDto } from '../dto/banner-groups/banner-group-response.dto';
import { BannerEntity, BannerGroupEntity } from '../../../schema.types';

/**
 * Mapper for Banner DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class BannerMapper {
  /**
   * Map entity to BannerResponseDto
   */
  static toDto(entity: BannerEntity): BannerResponseDto {
    return {
      id: entity.id,
      bannerGroupId: entity.bannerGroupId,
      title: entity.title,
      description: entity.description,
      pcImageFileId: entity.pcImageFileId,
      mobileImageFileId: entity.mobileImageFileId,
      linkUrl: entity.linkUrl,
      linkedProductMasterIds: entity.linkedProductMasterIds,
      displayStartAt: DateMapper.toNullableString(entity.displayStartAt),
      displayEndAt: DateMapper.toNullableString(entity.displayEndAt),
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      deletedAt: DateMapper.toNullableString(entity.deletedAt),
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map entity to BannerGroupResponseDto
   */
  static toGroupDto(entity: BannerGroupEntity): BannerGroupResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      title: entity.title,
      category: entity.category,
      pcWidth: entity.pcWidth,
      pcHeight: entity.pcHeight,
      mobileWidth: entity.mobileWidth,
      mobileHeight: entity.mobileHeight,
      description: entity.description,
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      deletedAt: DateMapper.toNullableString(entity.deletedAt),
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map arrays to DTOs
   */
  static toDtoArray(entities: BannerEntity[]): BannerResponseDto[] {
    return entities.map((e) => this.toDto(e));
  }

  static toGroupDtoArray(entities: BannerGroupEntity[]): BannerGroupResponseDto[] {
    return entities.map((e) => this.toGroupDto(e));
  }
}
