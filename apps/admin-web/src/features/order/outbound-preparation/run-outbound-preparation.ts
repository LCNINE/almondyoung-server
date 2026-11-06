import {
  isWaybillIssued,
  isWaybillPendingIssue,
} from '../../../lib/services/orders/waybill-policy';
import { parseServerError } from '../../../lib/api/server-error';
import type {
  PreparationWaybillResult,
  BulkShipmentResult,
  PickingMethod,
} from '../../../lib/types/dto/fulfillment';

export const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;

export type PreparationStage = 'plan' | 'waybill' | 'batch' | 'join';

export interface PreparationFailure {
  shipmentId: string;
  stage: PreparationStage;
  message: string;
}

export interface PreparationProgress {
  stage: PreparationStage;
  retrying: boolean;
  planned: number;
  waybilled: number;
  joined: number;
  total: number;
  batchId: string | null;
  batchName: string | null;
  failures: PreparationFailure[];
}

export interface PreparationDeps {
  planMany(ids: string[], key: string): Promise<BulkShipmentResult>;
  issueWaybills(
    ids: string[],
    key: string
  ): Promise<PreparationWaybillResult[]>;
  createBatch(input: {
    warehouseId: string;
    pickingMethod: PickingMethod;
    cartCapacity?: number;
    name: string;
  }): Promise<{ id: string }>;
  addManyToBatch(
    batchId: string,
    ids: string[],
    key: string
  ): Promise<BulkShipmentResult>;
  sleep(ms: number): Promise<void>;
  newKey(): string;
  waybillKeys: {
    get(shipmentId: string): string | undefined;
    set(shipmentId: string, key: string): void;
    delete(shipmentId: string): void;
  };
}

export interface PreparationInput {
  warehouseId: string;
  shipmentIds: string[];
  pickingMethod: PickingMethod;
  cartCapacity?: number;
  existingBatchId?: string;
  now: Date;
}

type StageResult = {
  shipmentId: string;
  outcome: 'success' | 'failed' | 'retry' | 'immediate';
  message?: string;
};

function bulkResults(result: BulkShipmentResult): StageResult[] {
  return [
    ...result.succeeded.map(
      (shipmentId): StageResult => ({ shipmentId, outcome: 'success' })
    ),
    ...result.failed.map(
      (failure): StageResult => ({
        shipmentId: failure.shipmentId,
        outcome: failure.transient ? 'retry' : 'failed',
        message: failure.message,
      })
    ),
  ];
}

export function batchNameFor(now: Date, pickingMethod: PickingMethod): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const labels: Record<PickingMethod, string> = {
    total_picking: '토탈피킹',
    individual: '개별피킹',
    multi_order: '멀티오더',
  };

  return `${part('month')}/${part('day')} ${labels[pickingMethod]} ${part('hour')}:${part('minute')}`;
}

export async function runOutboundPreparation(
  deps: PreparationDeps,
  input: PreparationInput,
  onProgress: (p: PreparationProgress) => void
): Promise<PreparationProgress> {
  let progress: PreparationProgress = {
    stage: 'plan',
    retrying: false,
    planned: 0,
    waybilled: 0,
    joined: 0,
    total: input.shipmentIds.length,
    batchId: input.existingBatchId ?? null,
    batchName: null,
    failures: [],
  };

  const report = (changes: Partial<PreparationProgress>) => {
    progress = { ...progress, ...changes };
    onProgress({ ...progress, failures: [...progress.failures] });
  };

  async function runStage(
    stage: PreparationStage,
    ids: string[],
    request: (remaining: string[], key: string) => Promise<StageResult[]>
  ): Promise<string[]> {
    const key = deps.newKey();
    const succeeded: string[] = [];
    const delayed = new Map<string, string>();
    let remaining = ids;
    let retries = 0;

    report({ stage, retrying: false });

    while (remaining.length > 0) {
      let results: StageResult[];

      try {
        results = await request(remaining, key);
      } catch (error) {
        const { status, message } = parseServerError(
          error,
          '출고 준비를 처리하지 못했어요.'
        );
        const transient = status === null || (status >= 500 && status < 600);

        results = remaining.map((shipmentId) => ({
          shipmentId,
          outcome: transient ? 'retry' : 'failed',
          message,
        }));
      }

      const byId = new Map(
        results.map((result) => [result.shipmentId, result])
      );
      const immediate: string[] = [];
      const failures = [...progress.failures];

      for (const shipmentId of remaining) {
        const result = byId.get(shipmentId);
        const message = result?.message ?? '처리 결과를 확인하지 못했어요.';

        if (result?.outcome === 'success') {
          succeeded.push(shipmentId);
        } else if (result?.outcome === 'immediate') {
          immediate.push(shipmentId);
        } else if (result?.outcome === 'retry') {
          delayed.set(shipmentId, message);
        } else {
          failures.push({ shipmentId, stage, message });
        }
      }

      report({
        failures,
        retrying: false,
        ...(stage === 'plan' ? { planned: succeeded.length } : {}),
        ...(stage === 'waybill' ? { waybilled: succeeded.length } : {}),
        ...(stage === 'join' ? { joined: succeeded.length } : {}),
      });

      if (immediate.length > 0) {
        remaining = immediate;
        report({ retrying: true });
        continue;
      }

      if (delayed.size === 0) {
        break;
      }

      if (retries === RETRY_DELAYS_MS.length) {
        report({
          failures: [
            ...progress.failures,
            ...Array.from(delayed, ([shipmentId, message]) => ({
              shipmentId,
              stage,
              message,
            })),
          ],
        });
        break;
      }

      remaining = [...delayed.keys()];
      delayed.clear();
      report({ retrying: true });
      await deps.sleep(RETRY_DELAYS_MS[retries++]);
    }

    return succeeded;
  }

  const planned = await runStage('plan', input.shipmentIds, async (ids, key) =>
    bulkResults(await deps.planMany(ids, key))
  );

  if (planned.length === 0) {
    return progress;
  }

  const waybilled = await runStage('waybill', planned, async (ids, key) => {
    const groups = new Map<string, string[]>();

    for (const id of ids) {
      const groupKey = deps.waybillKeys.get(id) ?? key;

      deps.waybillKeys.set(id, groupKey);
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), id]);
    }

    const results: PreparationWaybillResult[] = [];

    for (const [groupKey, groupIds] of groups) {
      results.push(...(await deps.issueWaybills(groupIds, groupKey)));
    }

    for (const result of results) {
      const unresolved =
        isWaybillPendingIssue(result.status) ||
        (!isWaybillIssued(result.status) && result.transient);

      if (!unresolved) {
        deps.waybillKeys.delete(result.shipmentId);
      }
    }

    return results.map(
      (result): StageResult => ({
        shipmentId: result.shipmentId,
        outcome: isWaybillIssued(result.status)
          ? 'success'
          : result.reason === 'time-budget-exceeded'
            ? 'immediate'
            : isWaybillPendingIssue(result.status) || result.transient
              ? 'retry'
              : 'failed',
        message: result.reason ?? '송장을 발급하지 못했어요.',
      })
    );
  });

  if (waybilled.length === 0) {
    return progress;
  }

  let batchId = input.existingBatchId;

  if (!batchId) {
    const name = batchNameFor(input.now, input.pickingMethod);

    await runStage('batch', waybilled, async (ids) => {
      const batch = await deps.createBatch({
        warehouseId: input.warehouseId,
        pickingMethod: input.pickingMethod,
        cartCapacity: input.cartCapacity,
        name,
      });

      batchId = batch.id;
      report({ batchId, batchName: name });

      return ids.map((shipmentId) => ({ shipmentId, outcome: 'success' }));
    });
  }

  if (!batchId) {
    return progress;
  }

  const targetBatchId = batchId;

  await runStage('join', waybilled, async (ids, key) =>
    bulkResults(await deps.addManyToBatch(targetBatchId, ids, key))
  );

  return progress;
}
