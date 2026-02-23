export type DevPointActionType = "EARN" | "REDEEM";
export type DevPointEventType =
  | "EARN"
  | "REDEEM"
  | "EARN_CANCEL"
  | "REDEEM_CANCEL";

export interface DevPointEventDetailRow {
  id: string;
  pointEventId: string;
  userId: string;
  eventType: DevPointEventType;
  amount: number;
  earnedEventDetailId: string | null;
  originalEventDetailId: string | null;
  createdAt: string;
}

export interface DevPointEventRow {
  id: string;
  userId: string;
  eventType: DevPointEventType;
  amount: number;
  originalEventId: string | null;
  intentId: string | null;
  legId: string | null;
  attemptId: string | null;
  providerIdempotencyKey: string;
  providerTransactionId: string | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  details: DevPointEventDetailRow[];
}

export type DevPointHoldStatus = "AUTHORIZED" | "CAPTURED" | "CANCELLED";

export interface DevPointHoldRow {
  id: string;
  userId: string;
  intentId: string;
  legId: string;
  authorizeAttemptId: string;
  amount: number;
  status: DevPointHoldStatus;
  capturedEventId: string | null;
  captureAttemptId: string | null;
  cancelAttemptId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DevPointSummary {
  confirmedAmount: number;
  reservedAmount: number;
  availableAmount: number;
  eventCount: number;
  holdCount: number;
}

export interface WalletDevPointsResponse {
  fetchedAt: string;
  userId: string;
  limit: number;
  summary: DevPointSummary;
  events: DevPointEventRow[];
  holds: DevPointHoldRow[];
}

export interface WalletDevPointActionRequest {
  userId: string;
  action: DevPointActionType;
  amount: number;
  reasonCode?: string;
  reasonMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface WalletDevPointActionResponse {
  performedAt: string;
  userId: string;
  action: DevPointActionType;
  amount: number;
  eventId: string;
  providerIdempotencyKey: string;
  summary: DevPointSummary;
}
