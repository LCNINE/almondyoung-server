import { inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../schema/inventory.schema';

/**
 * 기기가 응답을 못 받은 쓰기가 서버에 어떻게 남았는가 — 요청 키 기록으로만 판정한다.
 * - applied: 반영됐다 / rejected: 서버가 받았지만 반영하지 않고 닫았다 / abandoned: 관리자가 버렸다
 * - in_progress: 서버가 아직 처리 중이다 / not_applied: 서버에 아무것도 없다(버릴 수 있다)
 * - expired: 키 기록 보관 기간이 지나 판정할 수 없다
 */
export type OperationVerdict = 'applied' | 'rejected' | 'abandoned' | 'in_progress' | 'not_applied' | 'expired';

/** 키 기록 보관(30일)보다 하루 짧게 — 기기도 29일 넘은 작업은 다시 보내지 않는다. */
export const VERDICT_WINDOW_MS = 29 * 86_400_000;

/** 기기가 같은 키로 다시 보내면 결과가 정해지는 판정 — 기기에 «다시 확인»을 시킨다. */
export const DECIDED_VERDICTS: ReadonlySet<OperationVerdict> = new Set(['applied', 'rejected', 'abandoned']);

export interface VerdictInput {
  operationKey: string;
  /** 그 작업이 처음 생긴 때로 볼 수 있는 가장 이른 시각(기기 기록·첫 보고 중 이른 것) */
  since: Date;
}

/**
 * 명령은 끝났지만 아무것도 반영하지 않은 응답 — 출고 준비가 막혔다(«작업 시작» 전 등)거나, 결과 모름 강제출고를
 * 반영하지 않고 닫았다. 기기에는 거절로 돌아간다.
 */
function closedWithoutApplying(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || !('outcome' in response)) return false;
  return response.outcome === 'preparation_blocked' || response.outcome === 'rejected';
}

export async function operationVerdicts(
  trx: DbTx,
  inputs: readonly VerdictInput[],
  now: Date,
): Promise<Map<string, OperationVerdict>> {
  const keys = [...new Set(inputs.map((i) => i.operationKey))];
  const verdicts = new Map<string, OperationVerdict>();
  if (!keys.length) return verdicts;
  const abandoned = await trx
    .select({ key: wmsTables.abandonedOperationKeys.operationKey })
    .from(wmsTables.abandonedOperationKeys)
    .where(inArray(wmsTables.abandonedOperationKeys.operationKey, keys));
  const commands = await trx
    .select({
      key: wmsTables.fulfillmentCommandRequests.idempotencyKey,
      status: wmsTables.fulfillmentCommandRequests.status,
      response: wmsTables.fulfillmentCommandRequests.responseSnapshot,
    })
    .from(wmsTables.fulfillmentCommandRequests)
    .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, keys));
  const requests = await trx
    .select({
      key: wmsTables.inventoryIdempotencyRequests.key,
      response: wmsTables.inventoryIdempotencyRequests.response,
    })
    .from(wmsTables.inventoryIdempotencyRequests)
    .where(inArray(wmsTables.inventoryIdempotencyRequests.key, keys));

  const found = new Map<string, OperationVerdict>();
  for (const c of commands)
    found.set(
      c.key,
      c.status === 'failed' || (c.status === 'completed' && closedWithoutApplying(c.response))
        ? 'rejected'
        : c.status === 'completed'
          ? 'applied'
          : 'in_progress',
    );
  for (const r of requests) if (!found.has(r.key)) found.set(r.key, r.response === null ? 'in_progress' : 'applied');
  for (const a of abandoned) found.set(a.key, 'abandoned');

  for (const input of inputs) {
    const verdict = found.get(input.operationKey);
    if (verdict) verdicts.set(input.operationKey, verdict);
    else
      verdicts.set(
        input.operationKey,
        now.getTime() - input.since.getTime() >= VERDICT_WINDOW_MS ? 'expired' : 'not_applied',
      );
  }
  return verdicts;
}
