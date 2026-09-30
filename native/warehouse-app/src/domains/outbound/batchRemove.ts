import type { ApiClient } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import type { ShipmentByWaybill } from './types';

export type RemoveOutcome = { kind: 'removed' | 'blocked'; message: string };

/**
 * 「박스 빼기」(스펙 §8, PR 2 = 집기 전만). 시작된 배치의 박스는 송장이 늘 있으므로 송장번호로 찾는다.
 * 서버가 집은 몫을 확인한다 — 앱은 거절 문구만 보여 준다.
 */
export async function removeBoxFromBatch(
  deps: { api: ApiClient; newKey: () => string },
  input: { batchId: string; warehouseId: string; trackingNo: string; reason: string },
): Promise<RemoveOutcome> {
  try {
    const qs = new URLSearchParams({ trackingNo: input.trackingNo.trim(), warehouseId: input.warehouseId });
    const found = await deps.api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
    if (found.batchId !== input.batchId || !found.workItemId) return { kind: 'blocked', message: '이 배치에 있는 박스가 아니에요.' };
    await deps.api.request({
      method: 'DELETE',
      path: `/outbound-batches/${input.batchId}/shipments/${found.shipmentId}`,
      body: { reason: input.reason.trim() },
      idempotencyKey: deps.newKey(),
    });
    return { kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' };
  } catch (error) {
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
}
