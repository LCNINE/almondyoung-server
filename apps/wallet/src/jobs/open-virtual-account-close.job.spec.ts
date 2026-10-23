import { OpenVirtualAccountCloseJob } from './open-virtual-account-close.job';

function makeContext(rows: Record<string, unknown>[], status: unknown, cancelResult: unknown = { ok: true, data: {} }) {
  const updates: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }) }),
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  const tossApi = {
    getPaymentByOrderId: jest.fn().mockResolvedValue(status),
    cancelPayment: jest.fn().mockResolvedValue(cancelResult),
  };
  const job = new OpenVirtualAccountCloseJob({ db } as never, tossApi as never);
  return { job, tossApi, updates };
}

const LEFT_OPEN = {
  id: 'charge-va',
  responsePayload: { nextAction: { checkoutMode: 'WIDGET' }, virtualAccountLeftOpenAt: '2026-10-23T00:00:00.000Z' },
};
const WAITING = { ok: true, data: { status: 'WAITING_FOR_DEPOSIT', paymentKey: 'pk_va' } };

describe('OpenVirtualAccountCloseJob', () => {
  it('입금 대기 중인 계좌를 위젯 키·새 멱등 키로 닫고 표식을 지운다', async () => {
    const { job, tossApi, updates } = makeContext([LEFT_OPEN], WAITING);

    expect(await job.closeLeftOpen()).toEqual({ scanned: 1, closed: 1 });
    expect(tossApi.getPaymentByOrderId).toHaveBeenCalledWith('chargeva', true);
    // 첫 폐쇄 요청과 같은 키면 토스가 그 실패 응답을 재생한다.
    const [, , , idempotencyKey] = tossApi.cancelPayment.mock.calls[0];
    expect(idempotencyKey).not.toBe('cancel:wallet:authorize:charge-va');
    expect(updates[0]).toEqual(
      expect.objectContaining({ responsePayload: { nextAction: { checkoutMode: 'WIDGET' } } }),
    );
  });

  it('토스에서 이미 닫힌 계좌는 취소를 부르지 않고 표식을 지운다', async () => {
    const { job, tossApi } = makeContext([LEFT_OPEN], { ok: true, data: { status: 'CANCELED', paymentKey: 'pk_va' } });

    expect(await job.closeLeftOpen()).toEqual({ scanned: 1, closed: 1 });
    expect(tossApi.cancelPayment).not.toHaveBeenCalled();
  });

  it('상태를 모르거나 취소가 실패하면 표식을 남기고 순서만 뒤로 민다', async () => {
    const unknown = makeContext([LEFT_OPEN], { ok: false, error: { code: 'X', message: 'x' }, statusCode: 500 });
    expect(await unknown.job.closeLeftOpen()).toEqual({ scanned: 1, closed: 0 });
    expect(unknown.updates).toEqual([{ updatedAt: expect.any(Date) }]);

    const refused = makeContext([LEFT_OPEN], WAITING, { ok: false, error: { code: 'PROVIDER_ERROR', message: 'x' } });
    expect(await refused.job.closeLeftOpen()).toEqual({ scanned: 1, closed: 0 });
    expect(refused.updates).toEqual([{ updatedAt: expect.any(Date) }]);
  });
});
