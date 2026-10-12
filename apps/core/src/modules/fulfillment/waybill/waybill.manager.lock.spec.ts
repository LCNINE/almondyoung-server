import { inventoryTables } from '../../inventory/schema/inventory.schema';
import { WaybillManager } from './waybill.manager';

function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where', 'limit', 'for']) node[method] = jest.fn(() => node);
  node.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return node;
}

function makeManager() {
  const trx = chain([{ id: 'sh-1' }]);
  const reader = {
    // 잠근 뒤 읽으니 방금 취소된 박스가 보인다 — 여기서 409 로 멈춰 carrier 까지 가지 않는다
    loadIssueContext: jest.fn().mockResolvedValue({ status: 'cancelled', manifestVersion: 1 }),
    getActiveWaybill: jest.fn().mockResolvedValue(null),
  };
  const commands = { execute: jest.fn((_req: unknown, handler: (t: unknown) => unknown) => handler(trx)) };
  const registry = { get: () => ({ isConfigured: () => true }) };
  const dbService = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  const manager = new WaybillManager(
    reader as never,
    {} as never,
    {} as never,
    registry as never,
    commands as never,
    {} as never,
    dbService as never,
  );
  return { manager, reader, trx };
}

describe('송장 발급 — 채널 취소 확정과의 직렬화 (#1016 36번 재설계)', () => {
  it('박스 행을 FOR UPDATE 로 잠근 뒤에 발급 맥락을 읽는다 — 확정이 막 취소한 박스엔 409', async () => {
    const { manager, reader, trx } = makeManager();
    await expect(
      manager.issueForShipment('sh-1', { carrier: 'HANJIN', expectedManifestVersion: 1 }, 'k', { id: 'a', roles: [] }),
    ).rejects.toThrow('cancelled');
    const from = trx.from as jest.Mock;
    const lock = trx.for as jest.Mock;
    expect(from).toHaveBeenCalledWith(inventoryTables.shipments);
    expect(lock).toHaveBeenCalledWith('update');
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(reader.loadIssueContext.mock.invocationCallOrder[0]);
  });
});
