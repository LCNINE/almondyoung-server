import { WaybillManager } from './waybill.manager';
import type { WaybillRow } from './waybill.types';

const recipient = { recipientName: '테스트', phone: '01000000000', postalCode: '00000', roadAddress: '테스트 주소' };
const shipmentId = '00000000-0000-4000-8000-000000000001';
const opts = { carrier: 'HANJIN' as const, expectedManifestVersion: 3 };

function row(overrides: Partial<WaybillRow>): WaybillRow {
  const at = new Date('2026-11-09T00:00:00Z');
  return {
    id: 'w1',
    shipmentId,
    source: 'carrier',
    carrier: 'HANJIN',
    status: 'pending',
    trackingNo: null,
    custOrdNo: null,
    manifestVersion: 3,
    recipientHash: 'hash',
    labelData: null,
    lastError: null,
    attempts: 0,
    transientAttempts: 0,
    nextAttemptAt: null,
    issuedAt: null,
    voidedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function makeManager(ctx: { status: string; manifestVersion: number }, active: WaybillRow | null) {
  const reader = {
    loadIssueContext: jest.fn().mockResolvedValue({ ...ctx, recipientSnapshot: recipient, lines: [], entrancePassword: null }),
    getActiveWaybill: jest.fn().mockResolvedValue(active),
    recipientHashOf: () => 'hash',
  };
  const machine = { drive: jest.fn().mockResolvedValue(row({ status: 'registered' })) };
  const registry = { get: () => ({ isConfigured: () => true }) };
  const dbService = { run: (fn: (t: unknown) => unknown) => fn({}) };
  const manager = new WaybillManager(
    reader as never,
    {} as never,
    machine as never,
    registry as never,
    {} as never,
    {} as never,
    dbService as never,
  );
  return { manager, machine };
}

describe('WaybillManager.resumeActive — 원래 키를 잃은 호출이 멈춘 송장을 이어 간다', () => {
  it('활성 행이 없으면 null — 호출자가 새로 발급한다', async () => {
    const { manager, machine } = makeManager({ status: 'planned', manifestVersion: 3 }, null);

    await expect(manager.resumeActive(shipmentId, opts)).resolves.toBeNull();
    expect(machine.drive).not.toHaveBeenCalled();
  });

  it('planned 가 아닌 상자는 발급과 같은 이유로 거절한다', async () => {
    const { manager, machine } = makeManager({ status: 'cancelled', manifestVersion: 3 }, row({}));

    await expect(manager.resumeActive(shipmentId, opts)).rejects.toThrow('WAYBILL_NOT_DISPATCHABLE');
    expect(machine.drive).not.toHaveBeenCalled();
  });

  it('호출자가 본 버전과 상자 버전이 다르면 거절한다', async () => {
    const { manager } = makeManager({ status: 'planned', manifestVersion: 4 }, row({ manifestVersion: 4 }));

    await expect(manager.resumeActive(shipmentId, opts)).rejects.toThrow('WAYBILL_STALE_MANIFEST_VERSION');
  });

  it('재시도 시각 전의 일시 거절 행은 캐리어를 부르지 않고 그대로 돌려준다', async () => {
    const waiting = row({ transientAttempts: 1, nextAttemptAt: new Date(Date.now() + 60_000) });
    const { manager, machine } = makeManager({ status: 'planned', manifestVersion: 3 }, waiting);

    await expect(manager.resumeActive(shipmentId, opts)).resolves.toBe(waiting);
    expect(machine.drive).not.toHaveBeenCalled();
  });

  it('내용이 같은 allocated 행은 그 행을 drive 한다', async () => {
    const { manager, machine } = makeManager(
      { status: 'planned', manifestVersion: 3 },
      row({ status: 'allocated', trackingNo: '123' }),
    );

    await expect(manager.resumeActive(shipmentId, opts)).resolves.toMatchObject({ status: 'registered' });
    expect(machine.drive).toHaveBeenCalledWith('w1', expect.anything());
  });
});
