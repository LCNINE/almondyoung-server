import { DateMapper } from '../../../common/mappers';
import { ProductMasterVersion } from '../../../types';
import { ProductDto, ProductListItemDto } from '../dto/products/product-response.dto';

export class ProductMapper {
  static toDto(version: ProductMasterVersion): ProductDto {
    return {
      id: version.id,
      masterId: version.masterId,
      version: version.version,
      status: version.status,
      name: version.name,
      description: version.description,
      brand: version.brand,
      thumbnail: version.thumbnail,
      images: version.images,
      seoTitle: version.seoTitle,
      seoDescription: version.seoDescription,
      seoKeywords: version.seoKeywords,
      approvalStatus: version.approvalStatus,
      productType: version.productType,
      productCode: version.productCode,
      isWholesaleOnly: version.isWholesaleOnly ?? false,
      isMembershipOnly: version.isMembershipOnly ?? false,
      createdAt: DateMapper.toNotNullString(version.createdAt),
      updatedAt: DateMapper.toNotNullString(version.updatedAt),
      deletedAt: DateMapper.toNullableString(version.deletedAt),
    };
  }

  static toDtoArray(versions: ProductMasterVersion[]): ProductDto[] {
    return versions.map(v => this.toDto(v));
  }

  static toListItem(version: ProductMasterVersion): ProductListItemDto {
    return {
      id: version.id,
      masterId: version.masterId,
      name: version.name,
      thumbnail: version.thumbnail,
      status: version.status,
      createdAt: DateMapper.toNotNullString(version.createdAt),
    };
  }

  static toListItemArray(versions: ProductMasterVersion[]): ProductListItemDto[] {
    return versions.map(v => this.toListItem(v));
  }

}


