import { ConflictError } from '@app/shared';
import { AdminMembersReader } from './admin-members.reader';

// updateAutoRenewal 분기만 검증. drizzle 체인은 터미널(limit/returning) 반환값으로 시나리오 제어.
function makeReader(opts: {
  contractRow?: unknown; // 첫 select().limit() → 계약
  entitlementRow?: unknown; // 둘째 select().limit() → 현재 권한
  createAgreement?: jest.Mock; // paymentClientService.createBillingAgreement
}) {
  const setSpy = jest.fn();
  const limit = jest
    .fn()
    .mockResolvedValueOnce(opts.contractRow ? [opts.contractRow] : [])
    .mockResolvedValueOnce(opts.entitlementRow ? [opts.entitlementRow] : []);
  const txMock = {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'batch1' }]) }) }),
    update: () => ({ set: (v: unknown) => { setSpy(v); return { where: () => Promise.resolve(undefined) }; } }),
  };
  const transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(txMock));
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    transaction,
  };
  const createBillingAgreement = opts.createAgreement ?? jest.fn().mockResolvedValue(undefined);
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue({ id: 1 }) };
  const reader = new AdminMembersReader(
    { db } as never,
    contractEventManager as never,
    { createBillingAgreement } as never,
  );
  return { reader, setSpy, transaction, createBillingAgreement };
}

const axios404 = Object.assign(new Error('no selectable billing method'), {
  isAxiosError: true,
  response: { status: 404 },
});

describe('AdminMembersReader.updateAutoRenewal', () => {
  it('재활성 시 agreement 재생성이 4xx로 실패하면 ConflictError 를 던지고 상태를 커밋하지 않는다', async () => {
    const { reader, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: null, recurringCancelledAt: new Date(1_700_000_000_000) },
      entitlementRow: { endsAt: '2026-08-01' },
      createAgreement: jest.fn().mockRejectedValue(axios404),
    });
    await expect(reader.updateAutoRenewal('c1', true, 'admin1')).rejects.toBeInstanceOf(ConflictError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('재활성 해피패스: 별도 멱등키로 agreement 를 재생성한 뒤 상태를 복구한다', async () => {
    const createBillingAgreement = jest.fn().mockResolvedValue(undefined);
    const { reader, setSpy, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: null, recurringCancelledAt: new Date(1_700_000_000_000) },
      entitlementRow: { endsAt: '2026-08-01' },
      createAgreement: createBillingAgreement,
    });
    await reader.updateAutoRenewal('c1', true, 'admin1');
    expect(createBillingAgreement).toHaveBeenCalledWith(
      'u1',
      'c1',
      undefined,
      expect.stringMatching(/^membership:reactivate-agreement:c1:/),
    );
    expect(transaction).toHaveBeenCalled();
    const committed = setSpy.mock.calls[0][0];
    expect(committed).toMatchObject({ autoRenewal: true, recurringCancelledAt: null, nextBillingDate: '2026-08-01' });
  });

  it('현재 주기가 만료돼 활성 권한이 없으면 ConflictError 이고 wallet 을 호출하지 않는다', async () => {
    const createBillingAgreement = jest.fn();
    const { reader, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: null, recurringCancelledAt: null },
      entitlementRow: undefined,
      createAgreement: createBillingAgreement,
    });
    await expect(reader.updateAutoRenewal('c1', true, 'admin1')).rejects.toBeInstanceOf(ConflictError);
    expect(createBillingAgreement).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('자동갱신 OFF 는 wallet 호출 없이 상태만 뒤집는다', async () => {
    const createBillingAgreement = jest.fn();
    const { reader, setSpy, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: '2026-08-01', recurringCancelledAt: null },
      createAgreement: createBillingAgreement,
    });
    await reader.updateAutoRenewal('c1', false, 'admin1');
    expect(createBillingAgreement).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
    expect(setSpy.mock.calls[0][0]).toMatchObject({ autoRenewal: false });
    expect(setSpy.mock.calls[0][0]).not.toHaveProperty('recurringCancelledAt');
  });

  it('재활성 시 agreement 재생성이 5xx면 원본 에러를 전파하고 상태를 커밋하지 않는다', async () => {
    const axios500 = Object.assign(new Error('wallet down'), { isAxiosError: true, response: { status: 500 } });
    const { reader, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: null, recurringCancelledAt: new Date(1_700_000_000_000) },
      entitlementRow: { endsAt: '2026-08-01' },
      createAgreement: jest.fn().mockRejectedValue(axios500),
    });
    await expect(reader.updateAutoRenewal('c1', true, 'admin1')).rejects.toBe(axios500);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('재활성 시 403 등 비수단 4xx 는 ConflictError 로 오분류하지 않고 원본을 전파한다', async () => {
    const axios403 = Object.assign(new Error('forbidden'), { isAxiosError: true, response: { status: 403 } });
    const { reader, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: null, recurringCancelledAt: new Date(1_700_000_000_000) },
      entitlementRow: { endsAt: '2026-08-01' },
      createAgreement: jest.fn().mockRejectedValue(axios403),
    });
    await expect(reader.updateAutoRenewal('c1', true, 'admin1')).rejects.toBe(axios403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('recurringCancelledAt 이 없으면(관리자가 끈 자동갱신 재개) wallet 호출 없이 상태만 복구한다', async () => {
    const createBillingAgreement = jest.fn();
    const { reader, setSpy, transaction } = makeReader({
      contractRow: { userId: 'u1', nextBillingDate: '2026-08-01', recurringCancelledAt: null },
      createAgreement: createBillingAgreement,
    });
    await reader.updateAutoRenewal('c1', true, 'admin1');
    expect(createBillingAgreement).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
    expect(setSpy.mock.calls[0][0]).toMatchObject({ autoRenewal: true, recurringCancelledAt: null });
  });
});
