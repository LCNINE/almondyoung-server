import { isWaybillIssued, isWaybillPendingIssue } from './waybill-policy';
import { parseServerError } from '../../api/server-error';
import type {
  PreparationWaybillResult,
  BulkShipmentResult,
  PickingMethod,
} from '../../types/dto/fulfillment';

export const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;

export type PreparationStage = 'plan' | 'waybill' | 'batch' | 'join';

export interface PreparationFailure {
  shipmentId: string;
  stage: PreparationStage;
  message: string;
  retryable: boolean;
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
  createBatch(
    input: {
      warehouseId: string;
      pickingMethod: PickingMethod;
      cartCapacity?: number;
      name: string;
    },
    shipmentIds: string[]
  ): Promise<{ id: string; name: string }>;
  addManyToBatch(
    batchId: string,
    ids: string[],
    key: string
  ): Promise<BulkShipmentResult>;
  sleep(ms: number): Promise<void>;
  newKey(): string;
  now(): Date;
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

function isTransientStatus(status: number | null): boolean {
  return status === null || (status >= 500 && status < 600);
}

/**
 * 상자별 결과를 돌려주는 일괄 명령(부분출고 나누기 등)을 진행 창과 같은 규칙으로 다시 부른다(스펙 §5.1).
 * 일시 실패한 상자만 같은 키로 2/5/10초 뒤 다시 부르고, 확정 실패는 그대로 남긴다. 요청 자체가 거절(4xx)되면
 * 바로 던지고, 서버·네트워크 오류는 재시도하다 마지막에 던진다.
 */
export async function retryTransientBulk(
  run: (shipmentIds: string[]) => Promise<BulkShipmentResult>,
  shipmentIds: string[],
  sleep: (ms: number) => Promise<void>
): Promise<BulkShipmentResult> {
  const succeeded: string[] = [];
  const permanent: BulkShipmentResult['failed'] = [];
  let remaining = shipmentIds;

  for (let retries = 0; ; retries++) {
    let result: BulkShipmentResult;

    try {
      result = await run(remaining);
    } catch (error) {
      if (
        retries === RETRY_DELAYS_MS.length ||
        !isTransientStatus(parseServerError(error, '').status)
      ) {
        throw error;
      }

      await sleep(RETRY_DELAYS_MS[retries]);
      continue;
    }

    const transient = result.failed.filter((failure) => failure.transient);

    succeeded.push(...result.succeeded);
    permanent.push(...result.failed.filter((failure) => !failure.transient));

    if (transient.length === 0 || retries === RETRY_DELAYS_MS.length) {
      return { succeeded, failed: [...permanent, ...transient] };
    }

    remaining = transient.map((failure) => failure.shipmentId);
    await sleep(RETRY_DELAYS_MS[retries]);
  }
}

export function batchNameFor(now: Date, pickingMethod: PickingMethod): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const labels: Record<PickingMethod, string> = {
    total_picking: '토탈피킹',
    individual: '개별피킹',
    multi_order: '멀티오더',
  };

  return `${part('month')}/${part('day')} ${labels[pickingMethod]} ${part('hour')}:${part('minute')}:${part('second')}`;
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
        const transient = isTransientStatus(status);

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
          failures.push({ shipmentId, stage, message, retryable: false });
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
              retryable: true,
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

  // 송장 키는 단계마다 새로 만든다. 원래 키를 잃어도(다른 PC·새로고침) 서버가 상자의 활성 송장 행을
  // 이어 가므로 키를 브라우저에 붙들 필요가 없다.
  const waybilled = await runStage('waybill', planned, async (ids, key) => {
    // 요청 자체가 던지면 runStage 가 상태 코드로 재시도 여부를 정한다.
    const results = await deps.issueWaybills(ids, key);

    return results.map(
      (result): StageResult => ({
        shipmentId: result.shipmentId,
        outcome: isWaybillIssued(result.status)
          ? 'success'
          : result.transient === false
            ? 'failed'
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
    const name = batchNameFor(deps.now(), input.pickingMethod);

    await runStage('batch', waybilled, async (ids) => {
      const batch = await deps.createBatch(
        {
          warehouseId: input.warehouseId,
          pickingMethod: input.pickingMethod,
          cartCapacity: input.cartCapacity,
          name,
        },
        ids
      );

      batchId = batch.id;
      report({ batchId, batchName: batch.name });

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
