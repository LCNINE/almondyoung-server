import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandResult, FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { LabelCurrencyGuard } from '../waybill/label-currency.guard';
import { conflict } from './allocation/allocation.errors';
import {
  assertActiveBatchSession,
  assertWorkItemIdentity,
  databaseNow,
  loadPositiveShipmentCustody,
  loadWorkItem,
  loadWorkItemAllocations,
  lockAndAssertPickerClaim,
} from './allocation/allocation.queries';
import { ShipmentAllocation, ShipmentCustodyBalance } from './allocation/allocation.types';
import {
  CompletePickInput,
  HandoffPickingInput,
  InspectionReadyOutput,
  PickingActor,
  PickingHandoffResult,
  PickingStrategyName,
  UnpickShipmentInput,
  UnpickShipmentResult,
} from './picking-strategy.interface';
import {
  HeldSpots,
  Judgement,
  judgeCompleteAllocation,
  judgeHeldCustody,
  judgeUnpickCustody,
  packingRefOf,
} from './work-item-custody-judgement';

export interface WorkItemCommandDeps {
  commands: FulfillmentCommandService;
  workflowGate: FulfillmentWorkflowGate;
  labels: Pick<LabelCurrencyGuard, 'assertCurrent'>;
}

/** 7개 전진 입력이 모두 가진 필드. */
export interface WorkItemCommandTarget {
  batchId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface ForwardWorkItemCommand {
  strategy: PickingStrategyName;
  /** workflowGate 이름과 같다. */
  commandType: string;
  /** 전략이 지금 만드는 객체 그대로. */
  canonicalRequest: unknown;
  target: WorkItemCommandTarget;
  /** advisory 락 키, 순서대로. */
  locksBefore?: readonly string[];
}

/**
 * 트랜잭션 advisory 락 한 벌. 같은 키 문자열이면 서로 막는다 — 그래서 SQL 과 키 규칙을 한 곳에 둔다
 * (aggregate 의 카트 락은 `cartLockKey`, `aggregate-then-sort.strategy.ts`).
 */
export async function advisoryXactLock(trx: DbTx, key: string): Promise<void> {
  await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * 피킹 전진 명령의 문. 순서는 고정이다:
 * 워크플로 게이트 → 명령 멱등 실행 → 선행 advisory 락 → 피커 클레임 → 송장 최신성 → 활성 세션 → 본문.
 */
export async function runForwardWorkItemCommand<T>(
  deps: WorkItemCommandDeps,
  command: ForwardWorkItemCommand,
  body: (trx: DbTx, commandRequestId: string) => Promise<FulfillmentCommandResult<T>>,
  tx?: DbTx,
): Promise<T> {
  const { target } = command;
  deps.workflowGate.assertV2MutationAllowed(command.commandType);
  return deps.commands.execute(
    {
      commandType: command.commandType,
      idempotencyKey: target.idempotencyKey,
      canonicalRequest: command.canonicalRequest,
    },
    async (trx, commandRequestId) => {
      for (const key of command.locksBefore ?? []) {
        await advisoryXactLock(trx, key);
      }
      await lockAndAssertPickerClaim(
        trx,
        target.workItemId,
        target.batchId,
        target.shipmentId,
        target.actor.id,
        target.expectedLeaseVersion,
      );
      // 낡은 송장으로는 진행하지 않는다(스펙 I5). 작업 항목 잠금 뒤, 명령 핸들러 안.
      await deps.labels.assertCurrent(target.workItemId, trx);
      await assertActiveBatchSession(trx, target.sessionId, target.batchId, command.strategy);
      return body(trx, commandRequestId);
    },
    tx,
  );
}

// ── K1b: 완료·되돌림·인계 본문 한 벌 ─────────────────────────────────────────────

export interface CustodyCommandDeps extends WorkItemCommandDeps {
  sessions: Pick<BatchInventorySessionService, 'moveCustody'>;
  batches: Pick<OutboundBatchOrchestrator, 'handoff'>;
}

interface HolderContext {
  workItemId: string;
  shipmentId: string;
  pickerId: string;
}

/** 전략이 넘기는 것. 순서·판정·상태 쓰기는 커널이 고정한다(설계 §5.2). */
export interface PickingCustodyPolicy {
  /** commandType = `picking.${strategy}.complete|unpick|handoff` */
  strategy: PickingStrategyName;
  /** moveCustody·인계 클레임 멱등 키 접두사(':' 앞까지). 전략마다 불규칙하니 지금 코드에서 복사한다. */
  keys: { complete: string; unpick: string; handoffClaim: string; handoff: string };
  /** 들고 있어도 되는 자리. 판정은 하지 않는다. tote 는 락을 잡으므로 호출 위치를 커널이 고정한다. */
  loadHeldSpots(trx: DbTx, ctx: HolderContext): Promise<HeldSpots>;
  /** completePick 에서 PACKING 으로 옮길 custodyType. 이미 PACKING 인 행은 옮기지 않는다. */
  completeMovesFrom: 'WORKER' | 'TOTE' | 'SORTING';
  /** completePick 에서 허용 자리가 비었을 때(tote 만). */
  emptyHeldOnComplete?: { code: string; message: string };
  /** 인계 때 custody 가 사람을 따라가면 그 자리의 ref 규칙. tote 는 없음. */
  handoffCustody?: { custodyType: 'WORKER' | 'SORTING'; refFor(workItemId: string, workerId: string): string };
  /** 되돌림 이동 뒤·재큐잉 전(tote: releaseEmptyShipmentTotes). */
  afterUnpick?(trx: DbTx, shipmentId: string): Promise<void>;
  messages: {
    completeIncomplete(a: { shipmentLineId: string; sourceLocationId: string }): { code: string; message: string };
    ownerMismatchWhilePicking(ctx: { balanceId: string; pickerId: string; shipmentId: string }): string;
    handoffOwnerMismatch(ctx: { pickerId: string; shipmentId: string }): string;
    handoffCorrupt(balanceId: string): string;
  };
}

const RESOURCE_TYPE = 'outbound_batch_work_item';

/** grain 검사만 하려고 넘기는 자리 — 소유자 판정은 이 값으로 하지 않는다. */
const ANY_SPOT: HeldSpots = { empty: false, allows: () => true };

function isPrivileged(actor: PickingActor): boolean {
  return actor.roles.some((role) => role === 'logistics_manager' || role === 'master');
}

/** 완료 판정용 배정 grain 잔량. SETTLED 는 뺀다(설계 D2). */
async function loadAllocationCustody(trx: DbTx, sessionId: string, allocation: ShipmentAllocation) {
  const balances = wmsTables.batchInventorySessionBalances;
  return trx
    .select({ id: balances.id, custodyType: balances.custodyType, custodyRef: balances.custodyRef, qty: balances.qty })
    .from(balances)
    .where(
      and(
        eq(balances.sessionId, sessionId),
        eq(balances.shipmentLineId, allocation.shipmentLineId),
        eq(balances.sourceLocationId, allocation.sourceLocationId),
        ne(balances.custodyType, 'SETTLED'),
        gt(balances.qty, 0),
      ),
    )
    .orderBy(asc(balances.id));
}

/** 박스 잔량이 전부 지금 소유자 자리에 있어야 한다(인계 전·후). */
async function loadExclusivelyHeldCustody(
  trx: DbTx,
  policy: PickingCustodyPolicy,
  sessionId: string,
  holder: HolderContext,
): Promise<ShipmentCustodyBalance[]> {
  const balances = await loadPositiveShipmentCustody(trx, sessionId, holder.shipmentId);
  const held = await policy.loadHeldSpots(trx, holder);
  if (!judgeHeldCustody(balances, held)) {
    throw conflict(
      'PICKING_CUSTODY_OWNER_MISMATCH',
      policy.messages.handoffOwnerMismatch({ pickerId: holder.pickerId, shipmentId: holder.shipmentId }),
    );
  }
  return balances;
}

function assertUnpickJudgement(judgement: Judgement, policy: PickingCustodyPolicy, holder: HolderContext): void {
  if (judgement.ok) return;
  const balanceId = judgement.balanceId ?? '';
  switch (judgement.code) {
    case 'PICKING_CUSTODY_GRAIN_MISMATCH':
      throw conflict(judgement.code, `Balance ${balanceId} is not a work item allocation`);
    case 'PICKING_CUSTODY_OVERATTRIBUTED':
      throw conflict(judgement.code, `Balance grain ${judgement.grain ?? ''} exceeds its allocation`);
    case 'PICKING_CUSTODY_OWNER_MISMATCH':
      throw conflict(
        judgement.code,
        policy.messages.ownerMismatchWhilePicking({
          balanceId,
          pickerId: holder.pickerId,
          shipmentId: holder.shipmentId,
        }),
      );
    case 'PICKING_PACKING_CUSTODY_INCOMPLETE':
      throw conflict(judgement.code, 'Ready-to-pack custody must exactly match every work item allocation');
    default:
      throw new Error(`Unknown unpick judgement ${judgement.code}`);
  }
}

/** 피킹 완료: 배정 grain 마다 허용 자리 판정 → `completeMovesFrom` 행을 PACKING 으로 → ready_to_pack. */
export async function completeWorkItemPick(
  deps: CustodyCommandDeps,
  policy: PickingCustodyPolicy,
  input: CompletePickInput,
  tx?: DbTx,
): Promise<InspectionReadyOutput> {
  return runForwardWorkItemCommand<InspectionReadyOutput>(
    deps,
    {
      strategy: policy.strategy,
      commandType: `picking.${policy.strategy}.complete`,
      canonicalRequest: {
        strategy: policy.strategy,
        batchId: input.batchId,
        sessionId: input.sessionId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        actorId: input.actor.id,
        expectedLeaseVersion: input.expectedLeaseVersion,
      },
      target: input,
    },
    async (trx, commandRequestId) => {
      const allocations = await loadWorkItemAllocations(trx, input.workItemId);
      const packingRef = packingRefOf(input.workItemId);
      const holder = { workItemId: input.workItemId, shipmentId: input.shipmentId, pickerId: input.actor.id };
      const held = await policy.loadHeldSpots(trx, holder);
      if (policy.emptyHeldOnComplete && held.empty) {
        throw conflict(policy.emptyHeldOnComplete.code, policy.emptyHeldOnComplete.message);
      }
      for (const allocation of allocations) {
        const balances = await loadAllocationCustody(trx, input.sessionId, allocation);
        if (!judgeCompleteAllocation(allocation.qty, balances, held)) {
          const failure = policy.messages.completeIncomplete(allocation);
          throw conflict(failure.code, failure.message);
        }
        for (const balance of balances) {
          // custodyRef null 은 판정이 이미 거부했다 — 여기선 타입을 좁힐 뿐이다.
          if (balance.custodyType !== policy.completeMovesFrom || balance.custodyRef === null) continue;
          await deps.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `${policy.keys.complete}:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: allocation.skuId,
                sourceLocationId: allocation.sourceLocationId,
                custodyType: policy.completeMovesFrom,
                custodyRef: balance.custodyRef,
                shipmentLineId: allocation.shipmentLineId,
              },
              to: {
                skuId: allocation.skuId,
                sourceLocationId: allocation.sourceLocationId,
                custodyType: 'PACKING',
                custodyRef: packingRef,
                shipmentLineId: allocation.shipmentLineId,
              },
            },
            trx,
          );
        }
      }

      const now = await databaseNow(trx);
      const workItems = wmsTables.outboundBatchWorkItems;
      const [completed] = await trx
        .update(workItems)
        .set({
          status: 'ready_to_pack',
          pickerReleasedAt: now,
          leaseExpiresAt: null,
          leaseVersion: input.expectedLeaseVersion + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItems.id, input.workItemId),
            eq(workItems.batchId, input.batchId),
            eq(workItems.shipmentId, input.shipmentId),
            eq(workItems.status, 'picking'),
            eq(workItems.pickerId, input.actor.id),
            eq(workItems.leaseVersion, input.expectedLeaseVersion),
            gt(workItems.leaseExpiresAt, now),
          ),
        )
        .returning({ id: workItems.id });
      if (!completed) throw conflict('PICKING_STALE_CLAIM', 'Picker claim changed while completing pick');

      const lines = allocations.map((allocation) => ({
        shipmentLineId: allocation.shipmentLineId,
        skuId: allocation.skuId,
        sourceLocationId: allocation.sourceLocationId,
        quantity: allocation.qty,
      }));
      const response: InspectionReadyOutput = {
        operationId: commandRequestId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        custodyType: 'PACKING',
        custodyRef: packingRef,
        lines,
        totalQty: lines.reduce((total, line) => total + line.quantity, 0),
      };
      return { response, resourceType: RESOURCE_TYPE, resourceId: input.workItemId };
    },
    tx,
  );
}

/** 되돌림: 박스 잔량 전부 AT_SOURCE 로, 작업 항목은 queued. 송장 게이트를 부르지 않는다. */
export async function unpickWorkItemShipment(
  deps: CustodyCommandDeps,
  policy: PickingCustodyPolicy,
  input: UnpickShipmentInput,
  tx?: DbTx,
): Promise<UnpickShipmentResult> {
  const commandType = `picking.${policy.strategy}.unpick`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  return deps.commands.execute<UnpickShipmentResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: {
        strategy: policy.strategy,
        batchId: input.batchId,
        sessionId: input.sessionId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        actorId: input.actor.id,
        actorRoles: [...input.actor.roles].sort(),
        expectedLeaseVersion: input.expectedLeaseVersion,
      },
    },
    async (trx, commandRequestId) => {
      const item = await loadWorkItem(trx, input.workItemId, true);
      assertWorkItemIdentity(item, input.batchId, input.shipmentId);
      await assertActiveBatchSession(trx, input.sessionId, input.batchId, policy.strategy);
      if (item.leaseVersion !== input.expectedLeaseVersion) {
        throw conflict('PICKING_STALE_CLAIM', `Work item ${item.id} lease version changed`);
      }
      const allocations = await loadWorkItemAllocations(trx, input.workItemId);
      const now = await databaseNow(trx);
      if (item.status === 'picking') {
        if (
          item.pickerId !== input.actor.id ||
          item.pickerReleasedAt ||
          !item.leaseExpiresAt ||
          item.leaseExpiresAt.getTime() <= now.getTime()
        ) {
          throw conflict('PICKING_STALE_CLAIM', 'Only the active picker may unpick this work item');
        }
      } else if (item.status === 'ready_to_pack') {
        if (item.pickerId !== input.actor.id && !isPrivileged(input.actor)) {
          throw conflict('PICKING_UNPICK_FORBIDDEN', 'Only the previous picker or a manager may unpick');
        }
      } else {
        throw conflict('PICKING_NOT_UNPICKABLE', `Work item ${item.id} is ${item.status}`);
      }
      const status = item.status;

      const balances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
      const judged = { status, workItemId: input.workItemId, balances, allocations };
      // picking 이면 stale 검사가 pickerId === actor.id 를 보장한다.
      const holder = {
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        pickerId: item.pickerId ?? input.actor.id,
      };
      let held: HeldSpots | null = null;
      if (status === 'picking') {
        // grain 위반은 소유자 조회(tote 는 토트 락)보다 먼저 드러난다 — 지금 순서(설계 D3).
        assertUnpickJudgement(judgeUnpickCustody({ ...judged, held: ANY_SPOT }), policy, holder);
        held = await policy.loadHeldSpots(trx, holder);
      }
      assertUnpickJudgement(judgeUnpickCustody({ ...judged, held }), policy, holder);

      let returnedToSourceQty = 0;
      for (const balance of balances) {
        if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
          throw conflict('PICKING_CUSTODY_CORRUPT', `Assigned balance ${balance.id} is incomplete`);
        }
        await deps.sessions.moveCustody(
          {
            sessionId: input.sessionId,
            idempotencyKey: `${policy.keys.unpick}:${commandRequestId}:${balance.id}`,
            actorId: input.actor.id,
            quantity: balance.qty,
            from: {
              skuId: balance.skuId,
              sourceLocationId: balance.sourceLocationId,
              custodyType: balance.custodyType,
              custodyRef: balance.custodyRef,
              shipmentLineId: balance.shipmentLineId,
            },
            to: { skuId: balance.skuId, sourceLocationId: balance.sourceLocationId, custodyType: 'AT_SOURCE' },
          },
          trx,
        );
        returnedToSourceQty += balance.qty;
      }
      await policy.afterUnpick?.(trx, input.shipmentId);

      const workItems = wmsTables.outboundBatchWorkItems;
      const [requeued] = await trx
        .update(workItems)
        .set({
          status: 'queued',
          pickerReleasedAt: item.pickerReleasedAt ?? now,
          leaseExpiresAt: null,
          leaseVersion: item.leaseVersion + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItems.id, item.id),
            eq(workItems.leaseVersion, item.leaseVersion),
            inArray(workItems.status, ['picking', 'ready_to_pack']),
          ),
        )
        .returning({ id: workItems.id });
      if (!requeued) throw conflict('PICKING_STALE_CLAIM', 'Work item changed while unpicking');
      const response: UnpickShipmentResult = {
        operationId: commandRequestId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        status: 'queued',
        returnedToSourceQty,
      };
      return { response, resourceType: RESOURCE_TYPE, resourceId: input.workItemId };
    },
    tx,
  );
}

/** 피커 인계: 인계 전·후로 박스 잔량이 옛 소유자 자리에 있는지 보고, custody 가 사람을 따라가면 옮긴다. */
export async function handoffWorkItemPicker(
  deps: CustodyCommandDeps,
  policy: PickingCustodyPolicy,
  input: HandoffPickingInput,
  tx?: DbTx,
): Promise<PickingHandoffResult> {
  const commandType = `picking.${policy.strategy}.handoff`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  return deps.commands.execute<PickingHandoffResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: {
        strategy: policy.strategy,
        batchId: input.batchId,
        sessionId: input.sessionId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        targetWorkerId: input.targetWorkerId,
        expectedLeaseVersion: input.expectedLeaseVersion,
        reason: input.reason.trim(),
        actorId: input.actor.id,
        actorRoles: [...input.actor.roles].sort(),
      },
    },
    async (trx, commandRequestId) => {
      const item = await loadWorkItem(trx, input.workItemId);
      assertWorkItemIdentity(item, input.batchId, input.shipmentId);
      if (item.status !== 'picking' || !item.pickerId || item.leaseVersion !== input.expectedLeaseVersion) {
        throw conflict('PICKING_HANDOFF_NOT_ACTIVE', 'Work item has no active picker to hand off');
      }
      const oldOwnerId = item.pickerId;
      const holder = { workItemId: input.workItemId, shipmentId: input.shipmentId, pickerId: oldOwnerId };
      await loadExclusivelyHeldCustody(trx, policy, input.sessionId, holder);
      const handedOff = await deps.batches.handoff(
        input.workItemId,
        {
          claimType: 'picker',
          targetWorkerId: input.targetWorkerId,
          expectedLeaseVersion: input.expectedLeaseVersion,
          reason: input.reason,
        },
        `${policy.keys.handoffClaim}:${commandRequestId}`,
        input.actor,
        trx,
      );
      if (
        handedOff.workItem.batchId !== input.batchId ||
        handedOff.workItem.shipmentId !== input.shipmentId ||
        handedOff.workItem.pickerId !== input.targetWorkerId
      ) {
        throw conflict('PICKING_HANDOFF_STALE', 'Picker handoff returned an unexpected work item state');
      }
      await assertActiveBatchSession(trx, input.sessionId, input.batchId, policy.strategy);
      // 인계 뒤 PICKING_WORK_ITEM_CLOSED 검사는 두지 않는다 — batches.handoff 가 picking 에서만 성공한다(설계 §5.3).
      const balances = await loadExclusivelyHeldCustody(trx, policy, input.sessionId, holder);

      let movedQty = 0;
      const custody = policy.handoffCustody;
      // 같은 작업자에게 인계하면 옮길 것이 없다(설계 D1).
      if (custody && oldOwnerId !== input.targetWorkerId) {
        for (const balance of balances) {
          if (balance.custodyType !== custody.custodyType) continue;
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw conflict('PICKING_CUSTODY_CORRUPT', policy.messages.handoffCorrupt(balance.id));
          }
          await deps.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `${policy.keys.handoff}:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: custody.custodyType,
                custodyRef: custody.refFor(input.workItemId, oldOwnerId),
                shipmentLineId: balance.shipmentLineId,
              },
              to: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: custody.custodyType,
                custodyRef: custody.refFor(input.workItemId, input.targetWorkerId),
                shipmentLineId: balance.shipmentLineId,
              },
            },
            trx,
          );
          movedQty += balance.qty;
        }
      }
      const response: PickingHandoffResult = {
        operationId: commandRequestId,
        workItemId: input.workItemId,
        shipmentId: input.shipmentId,
        workerId: input.targetWorkerId,
        leaseVersion: handedOff.workItem.leaseVersion,
        movedQty,
      };
      return { response, resourceType: RESOURCE_TYPE, resourceId: input.workItemId };
    },
    tx,
  );
}
