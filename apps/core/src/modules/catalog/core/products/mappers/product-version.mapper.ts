import { DateMapper } from '../../../common/mappers';
import { ProductDetailCategory, ProductDetailDto } from '../../../catalog.types';
import { ProductImageDto } from '../dto/products/product-image.dto';
import { ProductImageMapper } from './product-image.mapper';

/**
 * Response DTO for version detail with serialized dates
 */
export interface ProductVersionDetailResponseDto {
  id: string;
  masterId: string;
  version: number;
  status: string;
  name: string;
  description: string | null;
  brand: string | null;
  thumbnail: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  descriptionHtml: string | null;
  isWholesaleOnly: boolean;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean;
  productType: string | null;
  fulfillmentKind: 'physical' | 'digital';
  productCode: string | null;
  alternativeName: string | null;
  material: string | null;
  salesClassification: string | null;
  purchaseClassification: string | null;
  shippingMethodId: string | null;
  shippingGroupCode: string | null;
  marketPrice: number | null;
  supplyPrice: number | null;
  supplierId: string | null;
  ageRestriction: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  salesStartDate: Date | null;
  salesEndDate: Date | null;
  parentVersionId: string | null;
  draftOwnerId: string | null;
  /**
   * 일괄 등록/수정 세션이 이 draft 를 잠갔다면 그 세션 id. 화면은 이 값이 있으면
   * 발행·삭제 버튼을 숨긴다 — 서버가 둘 다 409 로 거부하기 때문이다
   * (product-versions.service.ts 의 세션 잠금 가드).
   */
  bulkSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  images: ProductImageDto[];
  categories: ProductDetailCategory[];
  optionGroups: any[];
  variants: any[];
  channelProducts: any[];
  tagValues?: any[];
  priceSummary?: ProductDetailDto['priceSummary'];
  purchaseConstraint?: ProductDetailDto['purchaseConstraint'];
}

/**
 * Mapper for ProductVersion DTOs
 * Handles Date to ISO 8601 string conversion for version detail responses
 */
export class ProductVersionMapper {
  /**
   * Map ProductDetailDto to API response with serialized dates
   */
  static toDetailResponseDto(detail: ProductDetailDto): ProductVersionDetailResponseDto {
    return {
      id: detail.id,
      masterId: detail.masterId,
      version: detail.version,
      status: detail.status,
      name: detail.name,
      description: detail.description,
      brand: detail.brand,
      thumbnail: detail.thumbnail,
      seoTitle: detail.seoTitle,
      seoDescription: detail.seoDescription,
      seoKeywords: detail.seoKeywords,
      descriptionHtml: detail.descriptionHtml,
      isWholesaleOnly: detail.isWholesaleOnly,
      hideMembershipPriceForNonMembers: detail.hideMembershipPriceForNonMembers ?? detail.isMembershipOnly ?? false,
      isVisibleToMembersOnly: detail.isVisibleToMembersOnly ?? false,
      isOverseas: detail.isOverseas ?? false,
      isMembershipOnly: detail.hideMembershipPriceForNonMembers ?? detail.isMembershipOnly ?? false,
      productType: detail.productType,
      fulfillmentKind: (detail.fulfillmentKind ?? 'physical') as 'physical' | 'digital',
      productCode: detail.productCode,
      alternativeName: detail.alternativeName,
      material: detail.material,
      salesClassification: detail.salesClassification,
      purchaseClassification: detail.purchaseClassification,
      shippingMethodId: detail.shippingMethodId,
      shippingGroupCode: detail.shippingGroupCode ?? null,
      marketPrice: detail.marketPrice,
      supplyPrice: detail.supplyPrice,
      supplierId: detail.supplierId,
      ageRestriction: detail.ageRestriction,
      minQuantity: detail.minQuantity,
      maxQuantity: detail.maxQuantity,
      salesStartDate: detail.salesStartDate,
      salesEndDate: detail.salesEndDate,
      parentVersionId: detail.parentVersionId,
      draftOwnerId: detail.draftOwnerId,
      bulkSessionId: detail.bulkSessionId ?? null,
      createdAt: DateMapper.toNotNullString(detail.createdAt),
      updatedAt: DateMapper.toNotNullString(detail.updatedAt),
      images: detail.images.map((img) => ProductImageMapper.toDto(img)),
      categories: detail.categories,
      optionGroups: detail.optionGroups,
      variants: detail.variants,
      channelProducts: detail.channelProducts,
      tagValues: detail.tagValues,
      priceSummary: detail.priceSummary,
      purchaseConstraint: detail.purchaseConstraint ?? null,
    };
  }
}
