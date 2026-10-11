import { z } from 'zod';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { SETTLEMENT_REISSUE_GRACE_MS, SETTLE_DELAYED_AFTER_MS, settlementDeadline } from '../../fulfillment/order-progress/order-progress.thresholds';

/** 요청 행의 reason_code — 이 값으로 변경 기록 안의 취소 요청을 가린다. */
export const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';

export type CancelRequestStatus = 'requested' | 'settling' | 'applied' | 'rejected' | 'superseded';

export type CancelRequester =
  | { kind: 'operator'; actorId: string }
  | { kind: 'customer'; customerId: string }
  | { kind: 'wallet-refund-approval'; intentId: string };

/** 요청 행 `deltas` 의 원소. 전체취소는 «그때 남은 몫»을 기록용으로 담는다. */
export interface CancelRequestLine {
  type: 'cancel_line';
  salesOrderLineId: string;
  channelOrderItemId: string | null;
  quantity: number;
}

const CancelRequestLineSchema = z.object({
  type: z.literal('cancel_line'),
  salesOrderLineId: z.string().min(1),
  channelOrderItemId: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
});

const SettlementFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  at: z.string(),
});

const SettlementSchema = z.object({
  /** delayed 는 저장하지 않는다 — 확정 시각 + 30분으로 계산한다(settlementPhase) */
  state: z.enum(['in_progress', 'refused']),
  mode: z.enum(['auto', 'manual']),
  /** 이 방식으로 정산을 (다시) 시작한 시각. 이보다 이른 실패 사실은 지난 시도의 것이라 버린다 */
  since: z.string(),
  lastFailure: SettlementFailureSchema.optional(),
});

const CancelRequestMetadataSchema = z.object({
  // channel-amendment-actions 의 channelKeyOf 와 같은 자리 — 채널 키는 행 메타데이터 최상위에 둔다.
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  request: z.object({
    kind: z.literal('cancel'),
    scope: z.enum(['full', 'partial']),
    requestedBy: z.string().min(1),
    sourceKey: z.string().min(1),
    convertedFromFull: z.boolean().optional(),
    /** ChannelOrderCancelStalled 또는 수집된 진행 기록이 «수정됨 · 환불 미완»이라고 알렸다 */
    stage: z.literal('edited').optional(),
    /** 부분취소의 물리 취소를 반영한 시각 — 환불보다 먼저 올 수 있다 */
    appliedAt: z.string().optional(),
    /** 처음 낸 명령 그대로. [다시 보내기]가 같은 값을 다시 낸다 */
    command: z.custom<CancelChannelOrderPayload>((value) => typeof value === 'object' && value !== null),
  }),
  rejection: z
    .object({ reasonCode: z.string(), message: z.string(), at: z.string(), unresolvedRefundAmount: z.number().optional() })
    .optional(),
  outcome: z
    .object({
      refundAmount: z.number(),
      shippingCharge: z.number(),
      shippingRefund: z.number(),
      shippingNotAdjusted: z.boolean(),
      externalRefundApplied: z.number().optional(),
    })
    .optional(),
  supersededReason: z.string().optional(),
  settlement: SettlementSchema.optional(),
});

export type CancelRequestMetadata = z.infer<typeof CancelRequestMetadataSchema>;
export type SettlementMode = z.infer<typeof SettlementSchema>['mode'];
export type SettlementFailure = z.infer<typeof SettlementFailureSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;
export type SettlementPhase = 'in_progress' | 'delayed' | 'refused';

/** 작을수록 나쁘다 — 한 주문의 정산 중 요청 여럿 중 대표를 고를 때(보드·actions API) */
export const PHASE_RANK: Record<SettlementPhase, number> = { refused: 0, delayed: 1, in_progress: 2 };

/** 확정 시각은 요청 행의 created_at — 판정 SQL 도 같은 칸을 본다(D13) */
export function settlementPhase(settlement: Pick<Settlement, 'state'>, confirmedAt: Date, now: Date): SettlementPhase {
  if (settlement.state === 'refused') return 'refused';
  return now.getTime() - confirmedAt.getTime() > SETTLE_DELAYED_AFTER_MS ? 'delayed' : 'in_progress';
}

/** 리컨실러 36번이 다시 낼 정산 — 정산 중이고, 막 (다시) 시작한 지 SETTLEMENT_REISSUE_GRACE_MS 가 지났다. 거절은 운영자가 고른다 */
export function isReissuable(settlement: Settlement, now: Date): boolean {
  return settlement.state === 'in_progress' && now.getTime() - Date.parse(settlement.since) >= SETTLEMENT_REISSUE_GRACE_MS;
}

export interface SettlementView {
  requestId: string;
  phase: SettlementPhase;
  mode: SettlementMode;
  confirmedAt: string;
  deadlineAt: string;
  lastFailure: SettlementFailure | null;
}

/** jsonb 는 쓰는 쪽(이 폴더의 manager·settler)만 채운다 — 모양이 어긋나면 버그라 던진다. */
export function readCancelRequestMetadata(metadata: unknown): CancelRequestMetadata {
  return CancelRequestMetadataSchema.parse(metadata);
}

export function readCancelRequestLines(deltas: unknown): CancelRequestLine[] {
  return z.array(CancelRequestLineSchema).parse(deltas);
}

export interface CancelRequestView {
  id: string;
  status: CancelRequestStatus;
  scope: 'full' | 'partial';
  stage: 'edited' | null;
  convertedFromFull: boolean;
  requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string; unresolvedRefundAmount?: number } | null;
  outcome: {
    refundAmount: number;
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    externalRefundApplied?: number;
  } | null;
  /** 정산 중(settling)일 때만. 옛 requested 행·끝난 행은 null */
  settlement: SettlementView | null;
  /** 새 흐름(PR 5 뒤) 요청의 환불 방식. 옛 행은 null */
  refundMode: SettlementMode | null;
}

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

const VIEW_STATUSES: ReadonlySet<string> = new Set(['requested', 'settling', 'applied', 'rejected', 'superseded']);

function isViewStatus(value: string): value is CancelRequestStatus {
  return VIEW_STATUSES.has(value);
}

export function toSettlementView(
  row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>,
  now: Date,
): SettlementView | null {
  if (row.status !== 'settling') return null;
  const settlement = readCancelRequestMetadata(row.metadata).settlement;
  if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
  return {
    requestId: row.id,
    phase: settlementPhase(settlement, row.createdAt, now),
    mode: settlement.mode,
    confirmedAt: row.createdAt.toISOString(),
    deadlineAt: settlementDeadline(row.createdAt).toISOString(),
    lastFailure: settlement.lastFailure ?? null,
  };
}

export function toCancelRequestView(
  row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>,
  now: Date = new Date(),
): CancelRequestView {
  if (!isViewStatus(row.status)) throw new Error(`Cancel request ${row.id} has status ${row.status}`);
  const meta = readCancelRequestMetadata(row.metadata);
  return {
    id: row.id,
    status: row.status,
    scope: meta.request.scope,
    stage: meta.request.stage ?? null,
    convertedFromFull: meta.request.convertedFromFull ?? false,
    requestedAt: row.createdAt.toISOString(),
    rejection: meta.rejection ?? null,
    outcome: meta.outcome ?? null,
    settlement: toSettlementView(row, now),
    refundMode: meta.settlement?.mode ?? null,
  };
}
