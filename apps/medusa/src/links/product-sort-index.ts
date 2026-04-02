import { defineLink } from '@medusajs/framework/utils';
import ProductModule from '@medusajs/medusa/product';
import ProductSortingModule from '../modules/product-sorting';

export default defineLink(ProductModule.linkable.product, ProductSortingModule.linkable.productSortIndex);
