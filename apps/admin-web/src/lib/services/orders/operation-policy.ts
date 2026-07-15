export const FULFILLMENT_SCOPES = {
  operate: 'fulfillment.warehouse.operate',
  consolidate: 'fulfillment.shipment.consolidate',
  overrideRecipient: 'fulfillment.shipment.override_recipient',
  transferReservation: 'fulfillment.reservation.transfer',
  forceDispatch: 'fulfillment.dispatch.force',
  recall: 'fulfillment.dispatch.recall',
  reopen: 'fulfillment.shipment.reopen',
} as const;

export type FulfillmentAdminAction =
  | 'split'
  | 'reviseRecipient'
  | 'plan'
  | 'cancelOutstanding'
  | 'transferReservation'
  | 'consolidate'
  | 'issueInvoice'
  | 'voidInvoice'
  | 'forceDispatch'
  | 'recall'
  | 'pick'
  | 'inspect';

const ACTION_SCOPE: Record<FulfillmentAdminAction, string> = {
  split: FULFILLMENT_SCOPES.operate,
  reviseRecipient: FULFILLMENT_SCOPES.overrideRecipient,
  plan: FULFILLMENT_SCOPES.operate,
  cancelOutstanding: FULFILLMENT_SCOPES.operate,
  transferReservation: FULFILLMENT_SCOPES.transferReservation,
  consolidate: FULFILLMENT_SCOPES.consolidate,
  issueInvoice: FULFILLMENT_SCOPES.operate,
  voidInvoice: FULFILLMENT_SCOPES.reopen,
  forceDispatch: FULFILLMENT_SCOPES.forceDispatch,
  recall: FULFILLMENT_SCOPES.recall,
  pick: FULFILLMENT_SCOPES.operate,
  inspect: FULFILLMENT_SCOPES.operate,
};

/** UI visibility only; Core remains the authorization boundary. */
export function canShowFulfillmentAction(
  action: FulfillmentAdminAction,
  grantedScopes: readonly string[]
): boolean {
  return grantedScopes.includes(ACTION_SCOPE[action]);
}

/** Recall is only valid before carrier acceptance while the shipment remains shipped. */
export function canRecallShipment(
  shipmentStatus: string,
  dispatchAttemptStatuses: readonly string[]
): boolean {
  return (
    shipmentStatus === 'shipped' &&
    dispatchAttemptStatuses.some((status) => status === 'dispatched')
  );
}

export function isRecoverableOperation(
  status: string | null | undefined
): boolean {
  return (
    status === 'pending' ||
    status === 'in_progress' ||
    status === 'recovery_required'
  );
}
