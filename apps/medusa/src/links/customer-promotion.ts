import { defineLink } from '@medusajs/framework/utils';
import CustomerModule from '@medusajs/medusa/customer';
import PromotionModule from '@medusajs/medusa/promotion';

// isList: true on both sides = many-to-many
// 한 쿠폰을 여러 고객에게 발급하고, 한 고객이 여러 쿠폰을 가질 수 있음
export default defineLink(
  { linkable: CustomerModule.linkable.customer, isList: true },
  { linkable: PromotionModule.linkable.promotion, isList: true },
);
