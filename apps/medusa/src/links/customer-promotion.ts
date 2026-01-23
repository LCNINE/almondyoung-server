import { defineLink } from '@medusajs/framework/utils';
import CustomerModule from '@medusajs/medusa/customer';
import PromotionModule from '@medusajs/medusa/promotion';

export default defineLink(CustomerModule.linkable.customer, {
  linkable: PromotionModule.linkable.promotion,
  isList: true,
});
