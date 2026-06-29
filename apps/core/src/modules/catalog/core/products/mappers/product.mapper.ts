import { ProductMasterVersionEntity } from '../../../schema/catalog.schema.types';
import { DateMapper } from '../../../common/mappers';
import { ProductImageDto } from '../dto/products/product-image.dto';
import { PriceSummaryDto, ProductDto, ProductListItemDto } from '../dto/products/product-response.dto';

export class ProductMapper {
  static toDto(
    version: ProductMasterVersionEntity,
    images: ProductImageDto[],
    priceSummary: PriceSummaryDto | null = null,
  ): ProductDto {
    // thumbnail은 product_images에서 isPrimary=true인 이미지의 fileId 사용
    const primaryImage = images.find((img) => img.isPrimary);
    const thumbnail = primaryImage ? primaryImage.fileId : null;
    const hideMembershipPriceForNonMembers =
      version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false;

    return {
      id: version.id,
      masterId: version.masterId,
      version: version.version,
      status: version.status,
      name: version.name,
      description: version.description,
      brand: version.brand,
      thumbnail,
      images: images,
      seoTitle: version.seoTitle,
      seoDescription: version.seoDescription,
      seoKeywords: version.seoKeywords,
      approvalStatus: version.approvalStatus,
      productType: version.productType,
      productCode: version.productCode,
      isWholesaleOnly: version.isWholesaleOnly ?? false,
      hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: version.isVisibleToMembersOnly ?? false,
      isOverseas: version.isOverseas ?? false,
      isMembershipOnly: hideMembershipPriceForNonMembers,
      createdAt: DateMapper.toNotNullString(version.createdAt),
      updatedAt: DateMapper.toNotNullString(version.updatedAt),
      deletedAt: DateMapper.toNullableString(version.deletedAt),
      priceSummary,
    };
  }

  static toListItem(version: ProductMasterVersionEntity, primaryImageFileId?: string | null): ProductListItemDto {
    return {
      id: version.id,
      masterId: version.masterId,
      name: version.name,
      thumbnail: primaryImageFileId ?? null,
      status: version.status,
      createdAt: DateMapper.toNotNullString(version.createdAt),
    };
  }
}
