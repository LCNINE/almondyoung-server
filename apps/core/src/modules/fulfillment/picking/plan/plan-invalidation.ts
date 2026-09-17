export type PlanInvalidationCode =
  | 'SOURCE_STOCK_CHANGED'
  | 'PLAN_IDENTITY_CHANGED'
  | 'PLAN_NOT_DRAFT'
  | 'SHIPMENT_SNAPSHOT_CHANGED'
  | 'ALLOCATION_INVALID'
  | 'ELIGIBILITY_CHANGED';

export type PlanInvalidation = {
  code: PlanInvalidationCode;
  message: string;
};
