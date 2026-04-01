import { defineLink } from '@medusajs/framework/utils';
import ProductModule from '@medusajs/medusa/product';
import ProductSortModule from '../modules/product-sort';

export default defineLink(ProductModule.linkable.product, ProductSortModule.linkable.productSortKey);
