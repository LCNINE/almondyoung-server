import { MedusaService } from '@medusajs/framework/utils';
import ProductSortKey from './models/product-sort-key';

class ProductSortModuleService extends MedusaService({
  ProductSortKey,
}) {}

export default ProductSortModuleService;
