import { MedusaService } from '@medusajs/framework/utils';
import QuantityDiscountList from './models/quantity-discount-list';

class QuantityDiscountModuleService extends MedusaService({ QuantityDiscountList }) {}

export default QuantityDiscountModuleService;
