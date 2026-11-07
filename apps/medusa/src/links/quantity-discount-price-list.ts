import { defineLink } from '@medusajs/framework/utils';
import PricingModule from '@medusajs/medusa/pricing';
import QuantityDiscountModule from '../modules/quantity-discount';

// 수량 할인 리스트 행 하나 ↔ price list 하나. 가격 엔진은 price list 만 읽고, 우리는 이 링크로 리스트를 찾는다.
export default defineLink(QuantityDiscountModule.linkable.quantityDiscountList, PricingModule.linkable.priceList);
