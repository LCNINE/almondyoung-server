import { sql } from 'drizzle-orm';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandResult, FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { LabelCurrencyGuard } from '../waybill/label-currency.guard';
import { assertActiveBatchSession, lockAndAssertPickerClaim } from './allocation/allocation.queries';
import { PickingActor, PickingStrategyName } from './picking-strategy.interface';

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
        await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
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
