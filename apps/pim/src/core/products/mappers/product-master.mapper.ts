import { DateMapper } from '../../../common/mappers';
import {
  ProductMasterDto,
  OptionGroupDto,
  OptionValueDto,
  VariantDto,
  ChannelProductDto,
  ChannelInfoDto,
  ProductSummaryDto,
} from '../dto/masters/master-response.dto';
import {
  ProductMasterVersionEntity,
  ProductOptionGroupEntity,
  ProductOptionValueEntity,
  ProductVariantEntity,
  SalesChannelEntity,
  ChannelProductEntity,
} from '../../../schema.types';
import { ProductImageDto } from '../dto/products/product-image.dto';

/**
 * Mapper for ProductMaster DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ProductMasterMapper {
  /**
   * Map entity to ProductMasterDto
   */
  static toDto(entity: ProductMasterVersionEntity, images: ProductImageDto[]): ProductMasterDto {
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
      isMembershipOnly: entity.isMembershipOnly,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
    };
  }

  /**
   * Map entity to ProductSummaryDto
   */
  static toProductSummary(entity: Partial<ProductMasterVersionEntity> & {
    id: string;
    name: string;
    brand: string | null;
    isMembershipOnly: boolean;
    status: string;
    createdAt: Date;
    thumbnail?: string | null;
    optionGroupCount?: number;
    variantCount?: number;
  }): ProductSummaryDto {
    return {
      id: entity.id,
      name: entity.name,
      thumbnail: entity.thumbnail ?? null,
      brand: entity.brand,
      isMembershipOnly: entity.isMembershipOnly,
      status: entity.status,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      optionGroupCount: entity.optionGroupCount ?? 0,
      variantCount: entity.variantCount ?? 0,
    };
  }

  /**
   * Map entity to OptionGroupDto
   */
  static toOptionGroupDto(entity: ProductOptionGroupEntity & { displayName?: string; sortOrder?: number; isRequired?: boolean; values?: ProductOptionValueEntity[] }): OptionGroupDto {
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
  static toOptionValueDto(entity: ProductOptionValueEntity & { value?: string; displayName?: string; sortOrder?: number; isActive?: boolean }): OptionValueDto {
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
      images: entity.images,
      displayOrder: entity.displayOrder,
      status: entity.status,
      isDefault: entity.isDefault,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      optionValues: entity.optionValues ?? [],
      price: entity.price,
    };
  }

  /**
   * Map entity to ChannelInfoDto
   */
  static toChannelInfoDto(entity: SalesChannelEntity & { apiConfig?: unknown; supportedFeatures?: unknown }): ChannelInfoDto {
    return {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      isActive: entity.isActive,
      apiConfig: entity.apiConfig,
      supportedFeatures: entity.supportedFeatures,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map entity to ChannelProductDto
   */
  static toChannelProductDto(entity: ChannelProductEntity & { channel?: SalesChannelEntity & { apiConfig?: unknown; supportedFeatures?: unknown } }): ChannelProductDto {
    // channel은 필수 필드이므로, undefined일 경우 기본값 제공
    const defaultChannel: ChannelInfoDto = {
      id: '',
      type: 'marketplace',
      name: '',
      isActive: false,
      apiConfig: null,
      supportedFeatures: null,
      createdAt: '',
      updatedAt: '',
    };

    return {
      id: entity.id,
      masterId: entity.masterId,
      channelId: entity.channelId,
      name: entity.name,
      isActive: entity.isActive,
      channelSpecificData: entity.channelSpecificData,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
      channel: entity.channel
        ? this.toChannelInfoDto(entity.channel)
        : defaultChannel,
    };
  }
}
