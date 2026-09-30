import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import type { SessionStartAllocation } from '../picking/allocation/allocation.types';

type SessionRow = typeof wmsTables.batchInventorySessions.$inferSelect;
export type BatchInventorySessionRow = SessionRow;
type MutationEventType =
  | 'MOVE_CUSTODY'
  | 'RETURN_TO_SOURCE'
  | 'SETTLE_FOR_DISPATCH'
  | 'APPROVE_SHORTAGE'
  | 'HAND_BACK'
  | 'REMOVE_TO_RETURN_BIN'
  | 'PUTAWAY_RETURN';
export type BatchInventoryCustodyType = (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];

/** 박스 줄에 귀속된, 아직 나가지 않은 보관 — 이탈한 박스에서 바구니로 뺄 수 있는 곳(세 방식 공통, 스펙 §8). */
export const BOX_CUSTODY_TYPES = [
  'WORKER',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
] as const satisfies readonly BatchInventoryCustodyType[];

export interface BatchInventoryBucket {
  skuId: string;
  sourceLocationId: string;
  custodyType: BatchInventoryCustodyType;
  custodyRef?: string | null;
  shipmentLineId?: string | null;
}

export interface MoveBatchCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  actorId: string;
  quantity: number;
  from: BatchInventoryBucket;
  to: BatchInventoryBucket;
  context?: Record<string, unknown>;
}

export interface ReturnBatchCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  actorId: string;
  quantity: number;
  from: BatchInventoryBucket;
}

export interface SettleBatchCustodyInput extends ReturnBatchCustodyInput {
  dispatchAttemptSourceId: string;
}

export const APPROVED_SHORTAGE_REASON_CODES = ['MISSING', 'DAMAGED', 'DEFECTIVE'] as const;
export type ApprovedShortageReasonCode = (typeof APPROVED_SHORTAGE_REASON_CODES)[number];

export function isApprovedShortageReasonCode(value: unknown): value is ApprovedShortageReasonCode {
  return typeof value === 'string' && APPROVED_SHORTAGE_REASON_CODES.includes(value as ApprovedShortageReasonCode);
}

export interface ApproveBatchShortageInput {
  sessionId: string;
  idempotencyKey: string;
  shortPickOperationId: string;
  shipmentLineId: string;
  quantity: number;
  from: BatchInventoryBucket;
  reasonCode: ApprovedShortageReasonCode;
  reason: string;
  approverId: string;
}

export interface ReturnShortPickCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  shortPickOperationId: string;
  shipmentLineId: string;
  quantity: number;
  from: BatchInventoryBucket;
  reason: string;
  actorId: string;
}

function handInOrder(allocations: SessionStartAllocation[]): SessionStartAllocation[] {
  return [...allocations].sort(
    (left, right) =>
      left.sourceLocationId.localeCompare(right.sourceLocationId) ||
      left.shipmentLineId.localeCompare(right.shipmentLineId) ||
      left.id.localeCompare(right.id),
  );
}

/** 집지 않은 몫 반납(HAND_BACK) — AT_SOURCE 에서 빼고 세션 통제를 푼다. 배정 행 감소는 호출자(BoxAllocationManager)의 몫. */
export interface HandBackInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  workItemId: string;
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface ReturnBinRef {
  id: string;
  barcode: string;
}

/** 빼는 박스의 집은 몫(또는 토탈피킹 카트 여분)을 되돌림 바구니로. 배정 행 감소는 호출자(BoxAllocationManager)의 몫이다. */
export interface RemoveToReturnBinInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  workItemId: string;
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  from: { custodyType: BatchInventoryCustodyType; custodyRef: string | null; shipmentLineId: string | null };
  returnBin: ReturnBinRef;
}

/** 바구니 → 원래 로케이션. 세션 통제가 풀려 일반 재고가 된다(원장은 그대로 — 원장상 그 물건은 그 로케이션을 떠난 적이 없다). */
export interface PutawayReturnInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  returnBin: ReturnBinRef;
}

/**
 * 한 명령이 같은 배정을 두 보관(예: WORKER 1 + PACKING 1)에서 뺄 수 있어 보관 grain 을 키에 넣는다.
 * ref 는 길 수 있으므로(bulk-cart:<배치>:<카트>:<작업자>) 해시 16자로 줄인다 — 멱등 키 컬럼은 255자다.
 */
export function removeToBinIdempotencyKey(
  operationId: string,
  allocationId: string,
  from: RemoveToReturnBinInput['from'],
): string {
  const grain = createHash('sha256')
    .update([from.custodyType, from.custodyRef ?? '', from.shipmentLineId ?? ''].join('|'))
    .digest('hex')
    .slice(0, 16);
  return `remove-to-bin:${operationId}:${allocationId}:${grain}`;
}

export type ShortPickOperationIntentProof = {
  kind: 'short_pick';
  operationId: string;
  shipmentId: string;
  workItemId: string;
  sessionId: string;
  actorId: string;
  reason: string;
  lines: Array<{
    shipmentLineId: string;
    sourceLocationId: string;
    shortQty: number;
    allocationQty: number;
  }>;
};

export interface BatchInventorySessionFaultInjector {
  afterEventAppended?(eventType: string, sessionId: string, tx: DbTx): Promise<void> | void;
}

export const BATCH_INVENTORY_SESSION_FAULT_INJECTOR = Symbol('BATCH_INVENTORY_SESSION_FAULT_INJECTOR');

interface SessionEventSide {
  custodyType: BatchInventoryCustodyType;
  custodyRef: string | null;
  sourceLocationId: string;
  shipmentLineId: string | null;
}

function normalizedBucket(bucket: BatchInventoryBucket): SessionEventSide {
  return {
    custodyType: bucket.custodyType,
    custodyRef: bucket.custodyRef?.trim() || null,
    sourceLocationId: bucket.sourceLocationId,
    shipmentLineId: bucket.shipmentLineId ?? null,
  };
}

function bucketKey(bucket: SessionEventSide): string {
  return [bucket.custodyType, bucket.sourceLocationId, bucket.custodyRef ?? '', bucket.shipmentLineId ?? ''].join('|');
}

function stableJson(value: unknown, ancestors: Set<object>, arrayElement = false): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'bigint') throw new TypeError('BigInt is not JSON serializable');
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return arrayElement ? 'null' : undefined;
  }
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (ancestors.has(value)) throw new TypeError('Circular structure is not JSON serializable');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => stableJson(entry, ancestors, true) ?? 'null').join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const serialized = stableJson(record[key], ancestors);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function shortPickOperationIntentOf(snapshot: unknown): ShortPickOperationIntentProof | null {
  const intent = recordOf(recordOf(snapshot).intent);
  if (
    intent.kind !== 'short_pick' ||
    typeof intent.operationId !== 'string' ||
    typeof intent.shipmentId !== 'string' ||
    typeof intent.workItemId !== 'string' ||
    typeof intent.sessionId !== 'string' ||
    typeof intent.actorId !== 'string' ||
    typeof intent.reason !== 'string' ||
    !Array.isArray(intent.lines) ||
    intent.lines.length === 0
  ) {
    return null;
  }
  const lines: ShortPickOperationIntentProof['lines'] = [];
  const pairs = new Set<string>();
  for (const value of intent.lines) {
    const line = recordOf(value);
    if (
      typeof line.shipmentLineId !== 'string' ||
      typeof line.sourceLocationId !== 'string' ||
      !Number.isSafeInteger(line.shortQty) ||
      Number(line.shortQty) < 0 ||
      !Number.isSafeInteger(line.allocationQty) ||
      Number(line.allocationQty) < Number(line.shortQty)
    ) {
      return null;
    }
    const pair = `${line.shipmentLineId}:${line.sourceLocationId}`;
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    lines.push({
      shipmentLineId: line.shipmentLineId,
      sourceLocationId: line.sourceLocationId,
      shortQty: Number(line.shortQty),
      allocationQty: Number(line.allocationQty),
    });
  }
  return {
    kind: 'short_pick',
    operationId: intent.operationId,
    shipmentId: intent.shipmentId,
    workItemId: intent.workItemId,
    sessionId: intent.sessionId,
    actorId: intent.actorId,
    reason: intent.reason,
    lines,
  };
}

export function canonicalBatchSessionRequestHash(value: unknown): string {
  const canonical = stableJson(value, new Set());
  if (canonical === undefined) throw new TypeError('Request must be JSON serializable');
  return createHash('sha256').update(canonical).digest('hex');
}

export function handInRequestHash(batchId: string, allocation: SessionStartAllocation): string {
  return canonicalBatchSessionRequestHash({
    eventType: 'HAND_IN',
    batchId,
    workItemId: allocation.workItemId,
    allocationId: allocation.id,
    skuId: allocation.skuId,
    sourceLocationId: allocation.sourceLocationId,
    shipmentLineId: allocation.shipmentLineId,
    quantity: allocation.quantity,
    sourceStockVersion: allocation.sourceStockVersion,
  });
}

export function remainingShortPickAllocation(input: {
  allocatedQty: number;
  activeAttributedQty: number;
  returnedQty: number;
  settledQty: number;
  shortageQty: number;
}): number {
  return input.allocatedQty - input.activeAttributedQty - input.returnedQty - input.settledQty - input.shortageQty;
}

@Injectable()
export class BatchInventorySessionService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly audit: AuditService,
    @Optional()
    @Inject(BATCH_INVENTORY_SESSION_FAULT_INJECTOR)
    private readonly faultInjector?: BatchInventorySessionFaultInjector,
  ) {}

  async startSession(
    input: { batchId: string; actorId: string; allocations: SessionStartAllocation[] },
    tx: DbTx,
  ): Promise<SessionRow> {
    if (!tx) throw new Error('startSession requires the caller batch-start transaction');
    if (input.allocations.length === 0) {
      throw this.conflict('PICKING_BATCH_EMPTY', `Batch ${input.batchId} has no allocations to hand in`);
    }
    const [existing] = await tx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, input.batchId),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .limit(1)
      .for('update');
    if (existing) throw this.conflict('SESSION_ALREADY_STARTED', `Batch ${input.batchId} already has a session`);

    const [session] = await tx.insert(wmsTables.batchInventorySessions).values({ batchId: input.batchId }).returning();
    const started = await this.appendHandIns(
      tx,
      session,
      input.batchId,
      input.allocations,
      (allocation) => `start:${input.batchId}:${allocation.id}`,
    );
    const handedInQty = started.handedInQty;
    await this.audit.logUserActionRequired(
      'batch_inventory_session.start',
      'fulfillment',
      `Started inventory session ${session.id}`,
      { userId: input.actorId },
      {
        batchId: input.batchId,
        handedInQty,
        allocationIds: handInOrder(input.allocations).map((allocation) => allocation.id),
      },
      tx,
    );
    return started;
  }

  /**
   * 인계 이벤트·AT_SOURCE 를 쓰고 헤더를 한 번에 올린다(배치 시작·합류 공용). 호출자가 세션 행을 잠갔다.
   * 순번은 세션 version 에서 이어진다 — 복구가 이 순번만 믿는다(batch-session-recovery.service.ts).
   */
  private async appendHandIns(
    tx: DbTx,
    session: SessionRow,
    batchId: string,
    allocations: SessionStartAllocation[],
    idempotencyKeyOf: (allocation: SessionStartAllocation) => string,
  ): Promise<SessionRow> {
    let sequence = session.version;
    const ordered = handInOrder(allocations);
    for (const allocation of ordered) {
      await tx.insert(wmsTables.batchInventorySessionEvents).values({
        sessionId: session.id,
        idempotencyKey: idempotencyKeyOf(allocation),
        eventType: 'HAND_IN',
        skuId: allocation.skuId,
        quantity: allocation.quantity,
        toCustodyType: 'AT_SOURCE',
        toSourceLocationId: allocation.sourceLocationId,
        payload: {
          sequence,
          batchId,
          workItemId: allocation.workItemId,
          allocationId: allocation.id,
          shipmentLineId: allocation.shipmentLineId,
          sourceStockVersion: allocation.sourceStockVersion,
          requestHash: handInRequestHash(batchId, allocation),
        },
      });
      await tx
        .insert(wmsTables.batchInventorySessionBalances)
        .values({
          sessionId: session.id,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          custodyType: 'AT_SOURCE',
          qty: allocation.quantity,
        })
        .onConflictDoUpdate({
          target: [
            wmsTables.batchInventorySessionBalances.sessionId,
            wmsTables.batchInventorySessionBalances.skuId,
            wmsTables.batchInventorySessionBalances.sourceLocationId,
            wmsTables.batchInventorySessionBalances.custodyType,
            wmsTables.batchInventorySessionBalances.custodyRef,
            wmsTables.batchInventorySessionBalances.shipmentLineId,
          ],
          set: {
            qty: sql`${wmsTables.batchInventorySessionBalances.qty} + ${allocation.quantity}`,
            version: sql`${wmsTables.batchInventorySessionBalances.version} + 1`,
            updatedAt: sql`now()`,
          },
        });
      sequence += 1;
    }
    const handedInQty = session.handedInQty + ordered.reduce((total, allocation) => total + allocation.quantity, 0);
    const [updated] = await tx
      .update(wmsTables.batchInventorySessions)
      .set({ handedInQty, version: sequence, updatedAt: sql`now()` })
      .where(
        and(
          eq(wmsTables.batchInventorySessions.id, session.id),
          eq(wmsTables.batchInventorySessions.version, session.version),
        ),
      )
      .returning();
    if (!updated) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed while handing in`);
    await this.assertConservation(updated, tx);
    return updated;
  }

  /**
   * 실행 중 세션에 인계를 더한다(합류, PR 4 의 결품 재배정). 호출자가 이미 «작업 항목 → 세션 → 보관» 순으로 잠갔다.
   * 키는 `hand-in:<명령 id>:<배정 id>` — 같은 배정에 두 번째 인계가 와도 명령이 다르면 다른 키다(스펙 §13).
   */
  async handIn(
    input: {
      sessionId: string;
      batchId: string;
      actorId: string;
      operationId: string;
      allocations: SessionStartAllocation[];
    },
    tx: DbTx,
  ): Promise<SessionRow> {
    if (!tx) throw new Error('handIn requires the caller transaction');
    if (input.allocations.length === 0) {
      throw this.conflict('SESSION_HAND_IN_EMPTY', `Nothing to hand in to session ${input.sessionId}`);
    }
    const session = await this.lockSession(input.sessionId, tx);
    if (session.batchId !== input.batchId) {
      throw this.conflict(
        'SESSION_BATCH_MISMATCH',
        `Session ${input.sessionId} does not belong to batch ${input.batchId}`,
      );
    }
    if (session.status !== 'active') {
      throw this.conflict('SESSION_NOT_MUTABLE', `Batch inventory session ${input.sessionId} is ${session.status}`);
    }
    const updated = await this.appendHandIns(
      tx,
      session,
      input.batchId,
      input.allocations,
      (allocation) => `hand-in:${input.operationId}:${allocation.id}`,
    );
    await this.audit.logUserActionRequired(
      'batch_inventory_session.hand_in',
      'fulfillment',
      `Handed in ${updated.handedInQty - session.handedInQty} to session ${session.id}`,
      { userId: input.actorId },
      { batchId: input.batchId, operationId: input.operationId, allocationIds: input.allocations.map((a) => a.id) },
      tx,
    );
    return updated;
  }

  /** 집지 않은 몫 반납. 멱등 키 `hand-back:<명령 id>:<배정 id>`. */
  async handBack(input: HandBackInput, tx: DbTx) {
    if (!tx) throw new Error('handBack requires the caller transaction');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: `hand-back:${input.operationId}:${input.allocationId}`,
        eventType: 'HAND_BACK',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: {
          custodyType: 'AT_SOURCE',
          custodyRef: null,
          sourceLocationId: input.sourceLocationId,
          shipmentLineId: null,
        },
        to: null,
        context: {
          operationId: input.operationId,
          workItemId: input.workItemId,
          allocationId: input.allocationId,
          shipmentLineId: input.shipmentLineId,
        },
      },
      tx,
    );
  }

  /** 집은 몫(박스 보관) 또는 카트 여분(BULK_CART) → 되돌림 바구니. 멱등 키 `removeToBinIdempotencyKey`. */
  async removeToReturnBin(input: RemoveToReturnBinInput, tx: DbTx) {
    if (!tx) throw new Error('removeToReturnBin requires the caller transaction');
    const fromType = input.from.custodyType;
    if (!(BOX_CUSTODY_TYPES as readonly string[]).includes(fromType) && fromType !== 'BULK_CART') {
      throw new BadRequestException('Only box custody or a bulk cart can be removed to a return bin');
    }
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: removeToBinIdempotencyKey(input.operationId, input.allocationId, input.from),
        eventType: 'REMOVE_TO_RETURN_BIN',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: normalizedBucket({ skuId: input.skuId, sourceLocationId: input.sourceLocationId, ...input.from }),
        to: {
          custodyType: 'RETURN_PENDING',
          custodyRef: input.returnBin.barcode,
          sourceLocationId: input.sourceLocationId,
          shipmentLineId: null,
        },
        context: {
          operationId: input.operationId,
          workItemId: input.workItemId,
          allocationId: input.allocationId,
          shipmentLineId: input.shipmentLineId,
          returnBinId: input.returnBin.id,
        },
      },
      tx,
    );
  }

  /** 되돌림 적치. 멱등 키 `putaway-return:<명령 id>:<세션 id>` — 한 명령은 세션마다 한 보관 grain(바구니·SKU·로케이션)만 줄인다. */
  async putawayReturn(input: PutawayReturnInput, tx: DbTx) {
    if (!tx) throw new Error('putawayReturn requires the caller transaction');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: `putaway-return:${input.operationId}:${input.sessionId}`,
        eventType: 'PUTAWAY_RETURN',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: {
          custodyType: 'RETURN_PENDING',
          custodyRef: input.returnBin.barcode,
          sourceLocationId: input.sourceLocationId,
          shipmentLineId: null,
        },
        to: null,
        context: { operationId: input.operationId, returnBinId: input.returnBin.id },
      },
      tx,
    );
  }

  async moveCustody(input: MoveBatchCustodyInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    const to = normalizedBucket(input.to);
    if (from.custodyType === 'RETURN_PENDING' || to.custodyType === 'RETURN_PENDING') {
      throw new BadRequestException('Use removeToReturnBin / putawayReturn for RETURN_PENDING custody');
    }
    if (input.from.skuId !== input.to.skuId || from.sourceLocationId !== to.sourceLocationId) {
      throw new BadRequestException('Custody movement must preserve SKU and source location');
    }
    if (bucketKey(from) === bucketKey(to)) throw new BadRequestException('Source and target custody must differ');
    if (to.custodyType === 'SETTLED') {
      throw new BadRequestException('Use settleForDispatch for SETTLED custody');
    }
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'MOVE_CUSTODY',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to,
        context: input.context,
      },
      tx,
    );
  }

  async returnToSource(input: ReturnBatchCustodyInput, tx?: DbTx) {
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'RETURN_TO_SOURCE',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from: normalizedBucket(input.from),
        to: null,
      },
      tx,
    );
  }

  async settleForDispatch(input: SettleBatchCustodyInput, tx: DbTx) {
    if (!tx) throw new Error('settleForDispatch requires the caller dispatch transaction');
    const from = normalizedBucket(input.from);
    if (!from.shipmentLineId) throw new BadRequestException('Dispatch settlement requires shipment-line custody');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'SETTLE_FOR_DISPATCH',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: { ...from, custodyType: 'SETTLED', custodyRef: null },
        context: { dispatchAttemptSourceId: input.dispatchAttemptSourceId },
      },
      tx,
    );
  }

  async approveShortage(input: ApproveBatchShortageInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    if (!input.shortPickOperationId.trim()) throw new BadRequestException('shortPickOperationId is required');
    if (!input.shipmentLineId.trim()) throw new BadRequestException('shipmentLineId is required');
    if (!isApprovedShortageReasonCode(input.reasonCode)) {
      throw new BadRequestException('reasonCode must be one of MISSING, DAMAGED, DEFECTIVE');
    }
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    if (!input.approverId.trim()) throw new BadRequestException('approverId is required');
    if (from.shipmentLineId && from.shipmentLineId !== input.shipmentLineId) {
      throw new BadRequestException('Shortage attribution must match the source custody shipment line');
    }

    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'APPROVE_SHORTAGE',
        actorId: input.approverId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: null,
        context: {
          shortPickOperationId: input.shortPickOperationId,
          shipmentLineId: input.shipmentLineId,
          sourceLocationId: from.sourceLocationId,
          reasonCode: input.reasonCode,
          reason: input.reason.trim(),
          approverId: input.approverId,
        },
      },
      tx,
    );
  }

  async returnShortPickCustody(input: ReturnShortPickCustodyInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    if (!input.shortPickOperationId.trim()) throw new BadRequestException('shortPickOperationId is required');
    if (!input.shipmentLineId.trim()) throw new BadRequestException('shipmentLineId is required');
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    if (!input.actorId.trim()) throw new BadRequestException('actorId is required');
    if (from.shipmentLineId && from.shipmentLineId !== input.shipmentLineId) {
      throw new BadRequestException('Short-pick return attribution must match the source custody shipment line');
    }

    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'RETURN_TO_SOURCE',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: null,
        context: {
          shortPickOperationId: input.shortPickOperationId,
          shipmentLineId: input.shipmentLineId,
          sourceLocationId: from.sourceLocationId,
          reason: input.reason.trim(),
        },
      },
      tx,
    );
  }

  private async mutate(
    input: {
      sessionId: string;
      idempotencyKey: string;
      eventType: MutationEventType;
      actorId: string;
      skuId: string;
      quantity: number;
      from: SessionEventSide;
      to: SessionEventSide | null;
      context?: Record<string, unknown>;
    },
    tx?: DbTx,
  ) {
    if (!input.idempotencyKey.trim()) throw new BadRequestException('idempotencyKey is required');
    if (!input.actorId.trim()) throw new BadRequestException('actorId is required');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    this.assertBucket(input.from);
    if (input.from.custodyType === 'SETTLED') throw new BadRequestException('SETTLED custody is terminal');
    if (input.to) this.assertBucket(input.to);
    const fingerprint = canonicalBatchSessionRequestHash(input);

    return this.dbService.run(async (trx) => {
      const shortPickOperation =
        typeof input.context?.shortPickOperationId === 'string'
          ? await this.lockShortPickOperation(input.context.shortPickOperationId, trx)
          : null;
      // short-pick 작업 → 세션 순서로 잠근다. short-pick 명령은 이미 자기 영속 작업을 잡았다.
      const session = await this.lockSession(input.sessionId, trx);
      const [replay] = await trx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
            eq(wmsTables.batchInventorySessionEvents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        const payload = this.eventPayload(replay.payload);
        if (payload.requestHash !== fingerprint) {
          throw this.conflict(
            'SESSION_IDEMPOTENCY_MISMATCH',
            'Idempotency key was used for a different custody mutation',
          );
        }
        return { session, event: replay, replayed: true };
      }
      if (shortPickOperation && shortPickOperation.status !== 'pending') {
        throw this.conflict(
          shortPickOperation.status === 'completed'
            ? 'SESSION_SHORTAGE_OPERATION_COMPLETED'
            : 'SESSION_SHORTAGE_OPERATION_RECOVERY_ONLY',
          `A ${shortPickOperation.status} short-pick operation permits only exact existing event replay`,
        );
      }
      if (session.status !== 'active') {
        throw this.conflict('SESSION_NOT_MUTABLE', `Batch inventory session ${input.sessionId} is ${session.status}`);
      }

      if (input.eventType === 'SETTLE_FOR_DISPATCH') {
        const dispatchAttemptSourceId = input.context?.dispatchAttemptSourceId;
        if (typeof dispatchAttemptSourceId !== 'string') {
          throw new BadRequestException('dispatchAttemptSourceId is required');
        }
        await this.assertDispatchSettlementProof(
          {
            sessionId: input.sessionId,
            dispatchAttemptSourceId,
            quantity: input.quantity,
            skuId: input.skuId,
            from: input.from,
          },
          trx,
        );
      }
      if (input.eventType === 'APPROVE_SHORTAGE') {
        await this.assertShortageAllocation(input, shortPickOperation?.intent ?? null, trx);
      }
      if (input.eventType === 'RETURN_TO_SOURCE' && typeof input.context?.shortPickOperationId === 'string') {
        await this.assertShortageAllocation(input, shortPickOperation?.intent ?? null, trx);
      }

      await this.assertLineAssignment(session.batchId, input.skuId, input.from, trx);
      if (input.to) await this.assertLineAssignment(session.batchId, input.skuId, input.to, trx);
      const balances = await trx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId))
        .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
        .for('update');
      const source = balances.find((balance) => this.sameBucket(balance, input.skuId, input.from));
      if (!source || source.qty < input.quantity) {
        throw this.conflict('SESSION_CUSTODY_SHORT', 'Source custody does not contain the requested quantity');
      }

      const [event] = await trx
        .insert(wmsTables.batchInventorySessionEvents)
        .values({
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          skuId: input.skuId,
          quantity: input.quantity,
          fromCustodyType: input.from.custodyType,
          fromCustodyRef: input.from.custodyRef,
          fromSourceLocationId: input.from.sourceLocationId,
          fromShipmentLineId: input.from.shipmentLineId,
          toCustodyType: input.to?.custodyType,
          toCustodyRef: input.to?.custodyRef,
          toSourceLocationId: input.to?.sourceLocationId,
          toShipmentLineId: input.to?.shipmentLineId,
          payload: { ...input.context, sequence: session.version, requestHash: fingerprint, actorId: input.actorId },
        })
        .returning();
      await this.faultInjector?.afterEventAppended?.(input.eventType, input.sessionId, trx);

      const [decremented] = await trx
        .update(wmsTables.batchInventorySessionBalances)
        .set({
          qty: source.qty - input.quantity,
          version: source.version + 1,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.id, source.id),
            eq(wmsTables.batchInventorySessionBalances.version, source.version),
          ),
        )
        .returning();
      if (!decremented) throw this.conflict('SESSION_BALANCE_STALE', `Source balance ${source.id} changed`);

      if (input.to) {
        const target = balances.find((balance) => this.sameBucket(balance, input.skuId, input.to!));
        if (target) {
          const [incremented] = await trx
            .update(wmsTables.batchInventorySessionBalances)
            .set({ qty: target.qty + input.quantity, version: target.version + 1, updatedAt: sql`now()` })
            .where(
              and(
                eq(wmsTables.batchInventorySessionBalances.id, target.id),
                eq(wmsTables.batchInventorySessionBalances.version, target.version),
              ),
            )
            .returning();
          if (!incremented) throw this.conflict('SESSION_BALANCE_STALE', `Target balance ${target.id} changed`);
        } else {
          await trx.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: input.sessionId,
            skuId: input.skuId,
            sourceLocationId: input.to.sourceLocationId,
            custodyType: input.to.custodyType,
            custodyRef: input.to.custodyRef,
            shipmentLineId: input.to.shipmentLineId,
            qty: input.quantity,
          });
        }
      }

      if (input.to?.shipmentLineId) {
        await this.assertAttributedQuantity(session, input.to, trx);
      }
      const [remainingAfterMutation] = await trx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
            ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          ),
        );
      const isTerminal = Number(remainingAfterMutation?.qty ?? 0) === 0;
      const [updated] = await trx
        .update(wmsTables.batchInventorySessions)
        .set({
          version: session.version + 1,
          status: isTerminal ? 'settled' : 'active',
          completedAt: isTerminal ? sql`now()` : null,
          returnedQty:
            input.eventType === 'RETURN_TO_SOURCE' || input.eventType === 'PUTAWAY_RETURN'
              ? session.returnedQty + input.quantity
              : session.returnedQty,
          settledQty:
            input.eventType === 'SETTLE_FOR_DISPATCH' ? session.settledQty + input.quantity : session.settledQty,
          shortageQty:
            input.eventType === 'APPROVE_SHORTAGE' ? session.shortageQty + input.quantity : session.shortageQty,
          handedBackQty:
            input.eventType === 'HAND_BACK' ? session.handedBackQty + input.quantity : session.handedBackQty,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(wmsTables.batchInventorySessions.id, session.id),
            eq(wmsTables.batchInventorySessions.version, session.version),
          ),
        )
        .returning();
      if (!updated) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed`);
      await this.assertConservation(updated, trx);
      await this.audit.logUserActionRequired(
        `batch_inventory_session.${input.eventType.toLowerCase()}`,
        'fulfillment',
        `${input.eventType} ${input.quantity} in session ${input.sessionId}`,
        { userId: input.actorId },
        {
          eventId: event.id,
          idempotencyKey: input.idempotencyKey,
          sessionId: input.sessionId,
          sequence: session.version,
          ...(typeof input.context?.shortPickOperationId === 'string' ? input.context : {}),
        },
        trx,
      );
      return { session: updated, event, replayed: false };
    }, tx);
  }

  private async assertShortageAllocation(
    input: {
      sessionId: string;
      idempotencyKey: string;
      eventType: MutationEventType;
      actorId: string;
      skuId: string;
      quantity: number;
      from: SessionEventSide;
      to: SessionEventSide | null;
      context?: Record<string, unknown>;
    },
    intent: ShortPickOperationIntentProof | null,
    tx: DbTx,
  ): Promise<void> {
    const shortPickOperationId = input.context?.shortPickOperationId;
    const shipmentLineId = input.context?.shipmentLineId;
    const sourceLocationId = input.context?.sourceLocationId;
    if (
      typeof shortPickOperationId !== 'string' ||
      typeof shipmentLineId !== 'string' ||
      sourceLocationId !== input.from.sourceLocationId
    ) {
      throw new BadRequestException('Approved shortage requires exact operation, line, and source attribution');
    }
    const intentLine = intent?.lines.find(
      (line) => line.shipmentLineId === shipmentLineId && line.sourceLocationId === sourceLocationId,
    );
    if (
      !intent ||
      intent.operationId !== shortPickOperationId ||
      intent.sessionId !== input.sessionId ||
      intent.actorId !== input.actorId ||
      input.context?.reason !== intent.reason ||
      !intentLine
    ) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_INTENT_MISMATCH',
        'Custody reconciliation is outside the immutable short-pick operation intent',
      );
    }

    const [operationLine] = await tx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        and(
          eq(wmsTables.shipmentOperationMembers.shipmentId, wmsTables.shipmentLines.shipmentId),
          eq(wmsTables.shipmentOperationMembers.operationId, shortPickOperationId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .where(eq(wmsTables.shipmentLines.id, shipmentLineId))
      .limit(1)
      .for('update');
    if (!operationLine) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_OWNERSHIP_MISMATCH',
        'Short-pick operation does not own the attributed shipment line as a source member',
      );
    }

    const [duplicateOperation] = await tx
      .select({ idempotencyKey: wmsTables.batchInventorySessionEvents.idempotencyKey })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, input.eventType),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'shortPickOperationId' = ${shortPickOperationId}`,
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'shipmentLineId' = ${shipmentLineId}`,
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'sourceLocationId' = ${sourceLocationId}`,
          eq(wmsTables.batchInventorySessionEvents.fromCustodyType, input.from.custodyType),
          sql`${wmsTables.batchInventorySessionEvents.fromCustodyRef} IS NOT DISTINCT FROM ${input.from.custodyRef}`,
          sql`${wmsTables.batchInventorySessionEvents.fromShipmentLineId} IS NOT DISTINCT FROM ${input.from.shipmentLineId}::uuid`,
        ),
      )
      .limit(1);
    if (duplicateOperation) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_DUPLICATE',
        'Short-pick operation already recorded this line/source custody outcome',
      );
    }

    const [allocation] = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.workItemId, intent.workItemId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, shipmentLineId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, sourceLocationId),
        ),
      )
      .limit(1)
      .for('update');
    if (!allocation || allocation.skuId !== input.skuId) {
      throw this.conflict(
        'SESSION_SHORTAGE_NOT_ALLOCATED',
        'Approved shortage does not match an exact persisted picking allocation',
      );
    }

    const [terminal] = await tx.execute<{
      returnedQty: number;
      settledQty: number;
      shortageQty: number;
      operationReturnedQty: number;
      operationShortageQty: number;
    }>(sql`
      SELECT
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'RETURN_TO_SOURCE'
            AND (from_shipment_line_id = ${shipmentLineId}::uuid OR payload->>'shipmentLineId' = ${shipmentLineId})
        ), 0)::int AS "returnedQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'SETTLE_FOR_DISPATCH' AND from_shipment_line_id = ${shipmentLineId}::uuid
        ), 0)::int AS "settledQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'APPROVE_SHORTAGE' AND payload->>'shipmentLineId' = ${shipmentLineId}
        ), 0)::int AS "shortageQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'RETURN_TO_SOURCE'
            AND payload->>'shortPickOperationId' = ${shortPickOperationId}
            AND payload->>'shipmentLineId' = ${shipmentLineId}
            AND payload->>'sourceLocationId' = ${sourceLocationId}
        ), 0)::int AS "operationReturnedQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'APPROVE_SHORTAGE'
            AND payload->>'shortPickOperationId' = ${shortPickOperationId}
            AND payload->>'shipmentLineId' = ${shipmentLineId}
            AND payload->>'sourceLocationId' = ${sourceLocationId}
        ), 0)::int AS "operationShortageQty"
      FROM batch_inventory_session_events
      WHERE session_id = ${input.sessionId}::uuid
        AND (
          from_source_location_id = ${sourceLocationId}::uuid
          OR payload->>'sourceLocationId' = ${sourceLocationId}
        )
    `);
    const operationReturnedQty = Number(terminal?.operationReturnedQty ?? 0);
    const operationShortageQty = Number(terminal?.operationShortageQty ?? 0);
    if (input.eventType === 'APPROVE_SHORTAGE' && operationShortageQty + input.quantity > intentLine.shortQty) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_OPERATION_INTENT',
        `Approved shortage exceeds immutable intent quantity ${intentLine.shortQty}`,
      );
    }
    const intendedReturnQty = intentLine.allocationQty - intentLine.shortQty;
    if (input.eventType === 'RETURN_TO_SOURCE' && operationReturnedQty + input.quantity > intendedReturnQty) {
      throw this.conflict(
        'SESSION_RETURN_EXCEEDS_OPERATION_INTENT',
        `Terminal return exceeds immutable intent quantity ${intendedReturnQty}`,
      );
    }
    const [activeAttributed] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    const allocationRemaining = remainingShortPickAllocation({
      allocatedQty: allocation.qty,
      activeAttributedQty: Number(activeAttributed?.qty ?? 0),
      returnedQty: Number(terminal?.returnedQty ?? 0),
      settledQty: Number(terminal?.settledQty ?? 0),
      shortageQty: Number(terminal?.shortageQty ?? 0),
    });
    const newlyAttributedQty = input.from.shipmentLineId ? 0 : input.quantity;
    if (newlyAttributedQty > allocationRemaining) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_ALLOCATION',
        `Short-pick custody outcome exceeds allocation ${allocation.id}: remaining=${allocationRemaining}`,
      );
    }
  }

  private async lockShortPickOperation(
    shortPickOperationId: string,
    tx: DbTx,
  ): Promise<{ status: 'pending' | 'recovery_required' | 'completed'; intent: ShortPickOperationIntentProof }> {
    const [operation] = await tx
      .select({
        type: wmsTables.shipmentOperations.type,
        status: wmsTables.shipmentOperations.status,
        snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, shortPickOperationId))
      .limit(1)
      .for('update');
    const intent = shortPickOperationIntentOf(operation?.snapshot);
    if (
      !operation ||
      operation.type !== 'short_pick' ||
      !['pending', 'recovery_required', 'completed'].includes(operation.status) ||
      !intent ||
      intent.operationId !== shortPickOperationId
    ) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_INVALID',
        'Custody reconciliation requires an exact short-pick operation with immutable intent',
      );
    }
    return {
      status: operation.status as 'pending' | 'recovery_required' | 'completed',
      intent,
    };
  }

  private async lockSession(sessionId: string, tx: DbTx): Promise<SessionRow> {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session) throw new NotFoundException(`Batch inventory session ${sessionId} not found`);
    return session;
  }

  private assertBucket(bucket: SessionEventSide): void {
    if (!bucket.sourceLocationId) throw new BadRequestException('sourceLocationId is required');
    const assigned: readonly BatchInventoryCustodyType[] = BOX_CUSTODY_TYPES;
    if (bucket.custodyType === 'AT_SOURCE' && (bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('AT_SOURCE custody cannot have a ref or shipment line');
    }
    if (bucket.custodyType === 'BULK_CART' && (!bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('BULK_CART custody requires a ref and cannot have a shipment line');
    }
    if (assigned.includes(bucket.custodyType) && (!bucket.custodyRef || !bucket.shipmentLineId)) {
      throw new BadRequestException(`${bucket.custodyType} custody requires a ref and shipment line`);
    }
    if (bucket.custodyType === 'RETURN_PENDING' && (!bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('RETURN_PENDING custody requires a return bin ref and no shipment line');
    }
    if (bucket.custodyType === 'SETTLED' && (!bucket.shipmentLineId || bucket.custodyRef)) {
      throw new BadRequestException('SETTLED custody requires a shipment line and no custody ref');
    }
  }

  private async assertLineAssignment(
    batchId: string,
    skuId: string,
    bucket: SessionEventSide,
    tx: DbTx,
  ): Promise<void> {
    if (!bucket.shipmentLineId) return;
    const [allocation] = await tx
      .select({ id: wmsTables.pickingSourceAllocations.id })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
          eq(wmsTables.shipmentLines.skuId, skuId),
        ),
      )
      .limit(1);
    if (!allocation) {
      throw this.conflict('SESSION_LINE_NOT_ALLOCATED', 'Custody shipment line is not allocated in the session batch');
    }
  }

  private async assertDispatchSettlementProof(
    input: {
      sessionId: string;
      dispatchAttemptSourceId: string;
      quantity: number;
      skuId: string;
      from: SessionEventSide;
    },
    tx: DbTx,
  ): Promise<void> {
    const [sourceIdentity] = await tx
      .select({ dispatchAttemptId: wmsTables.dispatchAttemptSources.dispatchAttemptId })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1);
    if (!sourceIdentity) {
      throw this.conflict('SESSION_SETTLEMENT_WITHOUT_DISPATCH', 'Dispatch source does not exist');
    }
    await tx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, sourceIdentity.dispatchAttemptId))
      .limit(1)
      .for('update');
    await tx
      .select({ id: wmsTables.dispatchAttemptSources.id })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1)
      .for('update');
    const [source] = await tx
      .select({
        qty: wmsTables.dispatchAttemptSources.qty,
        sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
        shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
        stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
        attemptStatus: wmsTables.dispatchAttempts.status,
        lineSkuId: wmsTables.shipmentLines.skuId,
        lineShipmentId: wmsTables.shipmentLines.shipmentId,
        attemptShipmentId: wmsTables.dispatchAttempts.shipmentId,
        warehouseId: wmsTables.shipments.warehouseId,
        eventSkuId: wmsTables.stockEvents.skuId,
        eventWarehouseId: wmsTables.stockEvents.fromWarehouseId,
        eventLocationId: wmsTables.stockEvents.fromLocationId,
        eventState: wmsTables.stockEvents.fromState,
        eventToWarehouseId: wmsTables.stockEvents.toWarehouseId,
        eventToState: wmsTables.stockEvents.toState,
        eventTransition: wmsTables.stockEvents.transitionType,
        eventQty: wmsTables.stockEvents.quantity,
      })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.dispatchAttempts,
        eq(wmsTables.dispatchAttempts.id, wmsTables.dispatchAttemptSources.dispatchAttemptId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.dispatchAttempts.shipmentId))
      .innerJoin(wmsTables.stockEvents, eq(wmsTables.stockEvents.id, wmsTables.dispatchAttemptSources.stockEventId))
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1);
    if (
      !source ||
      !source.stockEventId ||
      source.attemptStatus !== 'pending' ||
      source.shipmentLineId !== input.from.shipmentLineId ||
      source.sourceLocationId !== input.from.sourceLocationId ||
      source.lineShipmentId !== source.attemptShipmentId ||
      source.lineSkuId !== input.skuId ||
      source.lineSkuId !== source.eventSkuId ||
      source.warehouseId !== source.eventWarehouseId ||
      source.sourceLocationId !== source.eventLocationId ||
      source.eventState !== 'ON_HAND' ||
      source.eventToWarehouseId !== null ||
      source.eventToState !== null ||
      source.eventTransition !== 'SHIP' ||
      source.eventQty !== source.qty ||
      input.quantity > source.qty
    ) {
      throw this.conflict(
        'SESSION_SETTLEMENT_WITHOUT_DISPATCH',
        'Custody can settle only after its exact dispatch source stock event in the caller transaction',
      );
    }
    const [alreadySettled] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionEvents.quantity}), 0)::int` })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'SETTLE_FOR_DISPATCH'),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'dispatchAttemptSourceId' = ${input.dispatchAttemptSourceId}`,
        ),
      );
    if (Number(alreadySettled?.qty ?? 0) + input.quantity > source.qty) {
      throw this.conflict('SESSION_SETTLEMENT_EXCEEDS_DISPATCH', 'Session settlement exceeds dispatch source quantity');
    }
  }

  private async assertAttributedQuantity(session: SessionRow, bucket: SessionEventSide, tx: DbTx): Promise<void> {
    const [allocated] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, session.batchId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId!),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
        ),
      );
    const [attributed] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, bucket.shipmentLineId!),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, bucket.sourceLocationId),
        ),
      );
    if (Number(attributed?.qty ?? 0) > Number(allocated?.qty ?? 0)) {
      throw this.conflict('SESSION_LINE_OVER_ALLOCATED', 'Custody quantity exceeds the picking source allocation');
    }
  }

  private async assertConservation(session: SessionRow, tx: DbTx): Promise<void> {
    const [remaining] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    const accounted =
      Number(remaining?.qty ?? 0) +
      session.settledQty +
      session.returnedQty +
      session.shortageQty +
      session.handedBackQty;
    if (accounted !== session.handedInQty) {
      throw this.conflict(
        'SESSION_CONSERVATION_FAILED',
        `Session ${session.id} handedIn=${session.handedInQty}, accounted=${accounted}`,
      );
    }
  }

  private sameBucket(
    balance: typeof wmsTables.batchInventorySessionBalances.$inferSelect,
    skuId: string,
    bucket: SessionEventSide,
  ): boolean {
    return (
      balance.skuId === skuId &&
      balance.sourceLocationId === bucket.sourceLocationId &&
      balance.custodyType === bucket.custodyType &&
      balance.custodyRef === bucket.custodyRef &&
      balance.shipmentLineId === bucket.shipmentLineId
    );
  }

  private eventPayload(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
