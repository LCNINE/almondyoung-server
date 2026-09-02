import { DateMapper } from '../../../common/mappers';
import { ShopListingEntity } from '../../../schema/catalog.schema.types';
import { ShopListingResponseDto } from '../dto/shop-listing-response.dto';

export class ShopListingMapper {
  static toDto(entity: ShopListingEntity): ShopListingResponseDto {
    return {
      id: entity.id,
      slug: entity.slug,
      title: entity.title,
      content: entity.content,
      region: entity.region,
      businessType: entity.businessType,
      dealType: entity.dealType,
      areaPyeong: entity.areaPyeong,
      deposit: entity.deposit,
      monthlyRent: entity.monthlyRent,
      keyMoney: entity.keyMoney,
      thumbnailFileId: entity.thumbnailFileId,
      images: entity.images ?? [],
      isActive: entity.isActive,
      viewCount: entity.viewCount,
      deletedAt: DateMapper.toNullableString(entity.deletedAt),
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  static toDtoArray(entities: ShopListingEntity[]): ShopListingResponseDto[] {
    return entities.map((e) => this.toDto(e));
  }
}
