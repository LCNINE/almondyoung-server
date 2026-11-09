import { defineLink } from '@medusajs/framework/utils';
import ProductModule from '@medusajs/medusa/product';
import BundleOfferModule from '../modules/bundle-offer';

/**
 * 상품 → 그 상품의 함께 구매 구성품(product.bundle_offers). 구성품 행의 product_id 로 잇는 읽기 전용 링크라
 * 링크 테이블이 없고, 목록 교체 때 링크를 따로 쓰지 않는다.
 */
export default defineLink(
  { linkable: ProductModule.linkable.product, field: 'id' },
  { ...BundleOfferModule.linkable.bundleOffer.id, primaryKey: 'product_id' },
  { readOnly: true, isList: true },
);
