import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/data/httpClient';
import { fetchReturn, recordArrival, recordInspection } from '../../../domains/customer-returns/api';
import { createReturnsServer, type FakeReturn } from './returnsServer';

const RETURN: FakeReturn = {
  id: 'cr-1',
  orderNo: 'O-1',
  customerName: '김민영',
  status: 'expected',
  requestedAt: '2026-10-20T00:00:00.000Z',
  lines: [{ id: 'l-1', productName: 'P', items: [{ id: 'i-1', skuName: 'S', expectedQty: 2, barcodes: ['880'] }] }],
};
const arrive = (quantity: number, idempotencyKey = 'k-1', warehouseId = 'w-1') => ({
  warehouseId,
  idempotencyKey,
  items: [{ customerReturnItemId: 'i-1', quantity }],
});
const inspect = (accepted: number, rejected = 0, held = 0) => ({
  items: [{ customerReturnItemId: 'i-1', accepted, rejected, held }],
});
const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof ApiError ? e.status : 'network')
  );

describe('가짜 core 의 반품 규칙(테스트 하네스)', () => {
  it('도착 — 첫 도착이 arrived, 같은 키 같은 수량은 그대로, 같은 키 다른 수량은 409, 기대 초과는 400', async () => {
    const api = createReturnsServer({ returns: [RETURN] });
    expect((await recordArrival(api, 'cr-1', arrive(1))).status).toBe('arrived');
    expect((await recordArrival(api, 'cr-1', arrive(1))).lines[0].items[0].arrivedQty).toBe(1);
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(2)))).toBe(409);
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(2, 'k-2')))).toBe(400);
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(1, 'k-3', 'w-2')))).toBe(400);
    expect(api.arrivals).toHaveLength(1);
    expect(api.arrivalCalls).toHaveLength(5);
  });

  it('도착 — 취소된 반품은 409, 미도착으로 닫은 반품은 새 키만 409', async () => {
    const api = createReturnsServer({ returns: [RETURN] });
    await recordArrival(api, 'cr-1', arrive(1));
    api.closeMissing('cr-1');
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(1)))).toBe('ok');
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(1, 'k-2')))).toBe(409);
    api.setStatus('cr-1', 'cancelled');
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(1)))).toBe(409);
  });

  it('검수 — 덜 왔으면 400, 합 ≠ 도착은 400, 보류가 있으면 held, 같은 결과 재요청은 그대로·다르면 409', async () => {
    const api = createReturnsServer({ returns: [RETURN] });
    await recordArrival(api, 'cr-1', arrive(1));
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(1)))).toBe(400);
    await recordArrival(api, 'cr-1', arrive(1, 'k-2'));
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(1)))).toBe(400);
    expect((await recordInspection(api, 'cr-1', inspect(1, 0, 1))).status).toBe('held');
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(1, 0, 1)))).toBe('ok');
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(2)))).toBe(409);
    expect(api.inspections).toHaveLength(1);
    // 정산까지 넘어간 뒤의 같은 결과 재전송도 core 처럼 그대로(INSPECTED_STATUSES)
    api.setStatus('cr-1', 'settled');
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(1, 0, 1)))).toBe('ok');
    expect(await statusOf(recordInspection(api, 'cr-1', inspect(2)))).toBe(409);
  });

  it('failNext — 네트워크 오류·상태, applied 면 반영하고 응답만 잃는다', async () => {
    const api = createReturnsServer({ returns: [RETURN] });
    api.failNext({ method: 'POST', applied: true });
    expect(await statusOf(fetchReturn(api, 'cr-1'))).toBe('ok');
    expect(await statusOf(recordArrival(api, 'cr-1', arrive(1)))).toBe('network');
    expect(api.view('cr-1').lines[0].items[0].arrivedQty).toBe(1);
    api.failNext({ status: 503 });
    expect(await statusOf(fetchReturn(api, 'cr-1'))).toBe(503);
    expect(await statusOf(fetchReturn(api, 'cr-1'))).toBe('ok');
  });
});
