import type { InferSelectModel } from 'drizzle-orm';
import {
  customerReturnLines,
  customerReturnReasonEnum,
  customerReturns,
  customerReturnStatusEnum,
} from '../../inventory/schema/inventory.schema';

export type CustomerReturnStatus = (typeof customerReturnStatusEnum.enumValues)[number];
export type CustomerReturnReason = (typeof customerReturnReasonEnum.enumValues)[number];
export type CustomerReturn = InferSelectModel<typeof customerReturns>;
export type CustomerReturnLine = InferSelectModel<typeof customerReturnLines>;
