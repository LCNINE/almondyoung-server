import { DateMapper } from '../../../common/mappers';
import { ProductVariantDto, VariantWithPriceDto } from '../dto/variants/variant-response.dto';
import { ProductVariantEntity } from '../../../schema.types';

/**
 * Mapper for ProductVariant DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class ProductVariantMapper {
  /**
   * Map entity to ProductVariantDto
   */
  static toDto(entity: ProductVariantEntity & { masterId?: string; versionId?: string }): ProductVariantDto {
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
    };
  }

  /**
   * Map entity to VariantWithPriceDto
   */
  static toWithPriceDto(
    entity: ProductVariantEntity & {
      masterId?: string;
      versionId?: string;
      optionValues?: Array<{ id: string; optionGroupId: string; createdAt: Date | null }>;
      price?: number;
    },
    price?: number,
  ): VariantWithPriceDto {
    return {
      ...this.toDto(entity),
      price: price ?? entity.price ?? 0,
      optionValues: entity.optionValues ?? [],
    };
  }
}
