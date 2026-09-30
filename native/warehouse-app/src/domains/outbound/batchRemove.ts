import type { ApiClient } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import type { ShipmentByWaybill } from './types';

export type RemoveOutcome = { kind: 'removed' | 'withdrawing' | 'blocked'; message: string };

const NOT_IN_THIS_BATCH = '이 배치에 있는 박스가 아니에요. 방금 뺐다면 이미 빠진 상태예요.';

/**
 * 「박스 빼기」(스펙 §8). 담은 상품이 있으면 «빼는 중» 으로 남는다(PR 3). 시작된 배치의 박스는 송장이 늘 있으므로 송장번호로 찾는다.
 * 서버가 집은 몫을 확인한다 — 앱은 거절 문구만 보여 준다.
 */
export async function removeBoxFromBatch(
  deps: { api: ApiClient; newKey: () => string },
  input: { batchId: string; warehouseId: string; trackingNo: string; reason: string },
): Promise<RemoveOutcome> {
  try {
    const qs = new URLSearchParams({ trackingNo: input.trackingNo.trim(), warehouseId: input.warehouseId });
    const found = await deps.api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
    // 빼는 응답을 잃고 다시 스캔하면 박스는 이미 빠져 이 배치에 없다 — 같은 문구가 그 경우도 알려 준다.
    if (found.batchId !== input.batchId || !found.workItemId) return { kind: 'blocked', message: NOT_IN_THIS_BATCH };
    const result = await deps.api.request<{ workItem?: { status?: string } }>({
      method: 'DELETE',
      path: `/outbound-batches/${input.batchId}/shipments/${found.shipmentId}`,
      body: { reason: input.reason.trim() },
      idempotencyKey: deps.newKey(),
    });
    // 담은 상품이 있으면 서버는 박스를 «빼는 중» 으로 둔다 — 상품이 바구니에 다 들어가야 빠진다(스펙 §8).
    if (result?.workItem?.status === 'withdrawing') {
      return {
        kind: 'withdrawing',
        message: '담은 상품이 있어 빼는 중이에요. 이 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
      };
    }
    return { kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' };
  } catch (error) {
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
}
