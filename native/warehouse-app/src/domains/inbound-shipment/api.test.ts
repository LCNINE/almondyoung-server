import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/data/httpClient';
import type { WorkPermissions } from '../../core/operations/OperationContext';
import {
  addBox,
  cancelBoxReceipt,
  findBoxes,
  listShipments,
  openBox,
  receiveBox,
} from './api';

function fake() {
  const request = vi.fn(async () => ({}) as never);
  return { api: { request } as unknown as ApiClient, request };
}

describe('inbound shipment box api', () => {
  it('findBoxes sends the label as typed, encoded', async () => {
    const { api, request } = fake();
    await findBoxes(api, 'w1', 'L 5/a');
    expect(request).toHaveBeenCalledWith({
      path: '/inventory/inbound-shipment-boxes?warehouseId=w1&label=L%205%2Fa',
    });
  });
  it('openBox reads one box', async () => {
    const { api, request } = fake();
    await openBox(api, 's1', 'b1');
    expect(request).toHaveBeenCalledWith({
      path: '/inventory/inbound-shipments/s1/boxes/b1',
    });
  });
  it('listShipments joins statuses', async () => {
    const { api, request } = fake();
    await listShipments(api, 'w1', ['expected', 'receiving']);
    expect(request).toHaveBeenCalledWith({
      path: '/inventory/inbound-shipments?warehouseId=w1&status=expected%2Creceiving',
    });
  });
  it('receiveBox posts counts with the idempotency key', async () => {
    const { api, request } = fake();
    const body = {
      counts: [{ lineId: 'l1', countedQty: 3, method: 'counted' as const }],
      unplanned: [],
    };
    await receiveBox(api, 's1', 'b1', body, 'key1');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/inventory/inbound-shipments/s1/boxes/b1/receive',
      body,
      idempotencyKey: 'key1',
    });
  });
  it('cancelBoxReceipt posts an empty body', async () => {
    const { api, request } = fake();
    await cancelBoxReceipt(api, 's1', 'b1', 'key2');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/inventory/inbound-shipments/s1/boxes/b1/receive/cancel',
      body: {},
      idempotencyKey: 'key2',
    });
  });
  it('addBox posts the label', async () => {
    const { api, request } = fake();
    await addBox(api, 's1', 'L99', 'key3');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/inventory/inbound-shipments/s1/boxes',
      body: { label: 'L99' },
      idempotencyKey: 'key3',
    });
  });
  it('work permissions carry inboundShipmentOperate', async () => {
    const p: WorkPermissions = { inboundShipmentOperate: true };
    expect(p.inboundShipmentOperate).toBe(true);
  });
});
