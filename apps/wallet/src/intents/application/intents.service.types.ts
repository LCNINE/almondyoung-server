import { PaymentIntentStatus } from '../../schema';
import {
  PaymentAttempt,
  PaymentIntent,
  PaymentLeg,
  RefundAllocation,
  RefundRequest,
} from '../../types';

export interface LegOperationResult {
  intent: PaymentIntent;
  leg: PaymentLeg;
  attempt: PaymentAttempt;
}

export interface IntentTerminationResult {
  intentId: string;
  status: PaymentIntentStatus;
}

export interface ExpireIntentsBatchResult {
  scanned: number;
  expired: number;
  reconcileRequired: number;
  skipped: number;
  failed: number;
}

export interface RefundRequestDetailResult {
  refundRequest: RefundRequest;
  allocations: RefundAllocation[];
}
