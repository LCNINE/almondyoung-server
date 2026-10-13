import { MedusaService } from '@medusajs/framework/utils';
import TimeSale from './models/time-sale';

export type TimeSaleStatus = 'draft' | 'active';

export type TimeSaleRecord = {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  status: TimeSaleStatus;
  product_order: string[];
};

class TimeSaleModuleService extends MedusaService({ TimeSale }) {}

export default TimeSaleModuleService;
