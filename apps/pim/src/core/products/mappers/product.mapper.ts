import { ProductMasterVersion } from '../../../types';
import { ProductDto, ProductListItemDto } from '../dto/products/product-response.dto';

export class ProductMapper {
  static toDto(version: ProductMasterVersion): ProductDto {
    return {
      id: version.id,
      masterId: version.masterId,
      version: version.version,
      versionStatus: version.versionStatus,
      name: version.name,
      description: version.description,
      brand: version.brand,
      thumbnail: version.thumbnail,
      images: version.images,
      attributes: version.attributes,
      seoTitle: version.seoTitle,
      seoDescription: version.seoDescription,
      seoKeywords: version.seoKeywords,
      status: version.status,
      approvalStatus: version.approvalStatus,
      productType: version.productType,
      productCode: version.productCode,
      isWholesaleOnly: version.isWholesaleOnly ?? false,
      isMembershipOnly: version.isMembershipOnly ?? false,
      createdAt: version.createdAt?.toISOString() ?? '',
      updatedAt: version.updatedAt?.toISOString() ?? '',
      deletedAt: version.deletedAt?.toISOString() ?? null,
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
      createdAt: version.createdAt?.toISOString() ?? '',
    };
  }

  static toListItemArray(versions: ProductMasterVersion[]): ProductListItemDto[] {
    return versions.map(v => this.toListItem(v));
  }
}


