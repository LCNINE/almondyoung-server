import { DateMapper } from '../../../common/mappers';
import { ProductMasterDto, OptionGroupDto, OptionValueDto, VariantDto } from '../dto/masters/master-response.dto';
import { PriceSummaryDto, ProductSummaryDto } from '../dto/products/product-response.dto';
import {
  ProductMasterVersionEntity,
  ProductOptionGroupEntity,
  ProductOptionValueEntity,
  ProductVariantEntity,
  SalesChannelEntity,
  ChannelProductEntity,
} from '../../../schema/catalog.schema.types';
import { ProductImageDto } from '../dto/products/product-image.dto';
import { ProductMasterWithVersion } from '../../../catalog.types';

/**
 * Mapper for ProductMaster DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ProductMasterMapper {
  /**
   * Map entity to ProductMasterDto
   */
  static toDto(entity: ProductMasterVersionEntity, images: ProductImageDto[]): ProductMasterDto {
    const hideMembershipPriceForNonMembers =
      entity.hideMembershipPriceForNonMembers ?? entity.isMembershipOnly ?? false;

    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      brand: entity.brand,
      // tags and attributes removed - deprecated/deleted fields
      images: images,
      seoTitle: entity.seoTitle,
      seoDescription: entity.seoDescription,
      seoKeywords: entity.seoKeywords,
      status: entity.status,
      isWholesaleOnly: entity.isWholesaleOnly,
      hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: entity.isVisibleToMembersOnly ?? false,
      isMembershipOnly: hideMembershipPriceForNonMembers,
      fulfillmentKind: (entity.fulfillmentKind ?? 'physical') as 'physical' | 'digital',
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
    };
  }

  /**
   * Map entity to ProductSummaryDto
   */

  static toProductSummary(
    entity: ProductMasterWithVersion & {
      optionGroupNames: string[];
      variantCount: number;
      thumbnail?: string | null; // product_images에서 가져온 primary 이미지 fileId
      priceSummary?: PriceSummaryDto | null;
    },
  ): ProductSummaryDto {
    // thumbnail은 product_images에서 가져온 값 사용
    const hideMembershipPriceForNonMembers =
      entity.version.hideMembershipPriceForNonMembers ?? entity.version.isMembershipOnly ?? false;

    return {
      versionId: entity.version.id,
      masterId: entity.id,
      name: entity.version.name,
      thumbnail: entity.thumbnail ?? null,
      brand: entity.version.brand,
      hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: entity.version.isVisibleToMembersOnly ?? false,
      isMembershipOnly: hideMembershipPriceForNonMembers,
      status: entity.version.status,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      optionGroupNames: entity.optionGroupNames,
      variantCount: entity.variantCount,
      priceSummary: entity.priceSummary ?? null,
    };
  }

  /**
   * Map entity to OptionGroupDto
   */
  static toOptionGroupDto(
    entity: ProductOptionGroupEntity & {
      displayName?: string;
      sortOrder?: number;
      isRequired?: boolean;
      values?: ProductOptionValueEntity[];
    },
  ): OptionGroupDto {
    return {
      id: entity.id,
      displayName: entity.displayName ?? '',
      sortOrder: entity.sortOrder ?? 0,
      isRequired: entity.isRequired ?? false,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      values: entity.values?.map((v) => this.toOptionValueDto(v)) ?? [],
    };
  }

  /**
   * Map entity to OptionValueDto
   */
  static toOptionValueDto(
    entity: ProductOptionValueEntity & { value?: string; displayName?: string; sortOrder?: number; isActive?: boolean },
  ): OptionValueDto {
    return {
      id: entity.id,
      value: entity.value ?? '',
      displayName: entity.displayName ?? '',
      sortOrder: entity.sortOrder ?? 0,
      isActive: entity.isActive ?? false,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
    };
  }

  /**
   * Map entity to VariantDto
   */
  static toVariantDto(
    entity: ProductVariantEntity & {
      masterId?: string;
      optionValues?: Array<{ id: string; optionGroupId: string; createdAt: Date | null }>;
      price?: number;
    },
  ): VariantDto {
    return {
      id: entity.id,
      masterId: entity.masterId ?? '',
      variantName: entity.variantName,
      imageId: entity.imageId,
      displayOrder: entity.displayOrder,
      status: entity.status,
      isDefault: entity.isDefault,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      optionValues: entity.optionValues ?? [],
      price: entity.price,
    };
  }
}
