import { z } from 'zod';
import { REFUND_FAILURE_KINDS, type CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { wmsTables } from '../../inventory/schema/inventory.schema';

/** 요청 행의 reason_code — 이 값으로 변경 기록 안의 취소 요청을 가린다. */
export const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';

export type CancelRequestStatus = 'requested' | 'applied' | 'rejected' | 'superseded';

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

/** 열린 요청에 붙는 wallet 환불 거절 사유(#1016 36번) — 요청은 닫지 않는다(보류 유지). 다시 보내기가 지운다 */
const RefundFailureRecordSchema = z.object({
  kind: z.enum(REFUND_FAILURE_KINDS),
  walletCode: z.string(),
  message: z.string(),
  at: z.string(),
});

export type CancelRequestRefundFailure = z.infer<typeof RefundFailureRecordSchema>;

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
    /** wallet 이 환불을 영구히 거절했다 — 보드가 «환불 불가 / 장부 불일치»로 갈라 보인다 */
    refundFailure: RefundFailureRecordSchema.optional(),
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
});

export type CancelRequestMetadata = z.infer<typeof CancelRequestMetadataSchema>;

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
  refundFailure: CancelRequestRefundFailure | null;
  rejection: { reasonCode: string; message: string; at: string; unresolvedRefundAmount?: number } | null;
  outcome: {
    refundAmount: number;
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    externalRefundApplied?: number;
  } | null;
}

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

const VIEW_STATUSES: ReadonlySet<string> = new Set(['requested', 'applied', 'rejected', 'superseded']);

function isViewStatus(value: string): value is CancelRequestStatus {
  return VIEW_STATUSES.has(value);
}

export function toCancelRequestView(
  row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>,
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
    refundFailure: meta.request.refundFailure ?? null,
    rejection: meta.rejection ?? null,
    outcome: meta.outcome ?? null,
  };
}
