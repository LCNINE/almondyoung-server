import { ConflictError } from '@app/shared';
import { WaybillManager } from './waybill.manager';
import { assertShipmentNotHeld } from '../hold/cancel-request-hold';

jest.mock('../hold/cancel-request-hold', () => ({
  ...jest.requireActual('../hold/cancel-request-hold'),
  assertShipmentNotHeld: jest.fn(),
}));

const held = assertShipmentNotHeld as jest.MockedFunction<typeof assertShipmentNotHeld>;

function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where', 'limit', 'for']) node[method] = jest.fn(() => node);
  node.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return node;
}

function makeManager() {
  const trx = chain([{ id: 'sh-1', manifestVersion: 1, recipientSnapshot: {} }]);
  const reader = {
    loadIssueContext: jest.fn().mockResolvedValue({ status: 'planned', manifestVersion: 1 }),
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

describe('송장 관문 — 열린 취소 요청 (#1016 35번 §5.3)', () => {
  beforeEach(() => held.mockReset());

  it('발송 사전검사: 보류면 활성 송장을 보기 전에 CANCEL_REQUESTED', async () => {
    held.mockRejectedValue(new ConflictError('CANCEL_REQUESTED: x'));
    const { manager, reader } = makeManager();
    await expect(manager.assertDispatchable('sh-1')).rejects.toThrow('CANCEL_REQUESTED');
    expect(reader.getActiveWaybill).not.toHaveBeenCalled();
  });

  it('발급: 박스 행을 잠근 뒤 보류를 묻고, 보류면 발급 맥락을 읽지 않는다', async () => {
    held.mockRejectedValue(new ConflictError('CANCEL_REQUESTED: x'));
    const { manager, reader, trx } = makeManager();
    await expect(
      manager.issueForShipment('sh-1', { carrier: 'HANJIN', expectedManifestVersion: 1 }, 'k', { id: 'a', roles: [] }),
    ).rejects.toThrow('CANCEL_REQUESTED');
    expect(trx.for).toHaveBeenCalledWith('update');
    expect(reader.loadIssueContext).not.toHaveBeenCalled();
  });
});
