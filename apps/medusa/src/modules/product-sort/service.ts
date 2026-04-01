import { MedusaService } from '@medusajs/framework/utils';
import { ProductSortKey } from './models/product-sort-key';

export class ProductSortModuleService extends MedusaService({ ProductSortKey }) {}
