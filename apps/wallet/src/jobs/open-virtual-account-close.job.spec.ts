import { OpenVirtualAccountCloseJob } from './open-virtual-account-close.job';

function makeContext(rows: Record<string, unknown>[], cancelResult: unknown) {
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
  const tossApi = { cancelPayment: jest.fn().mockResolvedValue(cancelResult) };
  const job = new OpenVirtualAccountCloseJob({ db } as never, tossApi as never);
  return { job, tossApi, updates };
}

const LEFT_OPEN = {
  id: 'charge-va',
  providerTransactionId: 'pk_va',
  providerIdempotencyKey: 'wallet:authorize:charge-va',
  responsePayload: { nextAction: { checkoutMode: 'WIDGET' }, virtualAccountLeftOpenAt: '2026-10-23T00:00:00.000Z' },
};

describe('OpenVirtualAccountCloseJob', () => {
  it('취소된 charge 에 남은 위젯 계좌를 위젯 키로 닫고 표식을 지운다', async () => {
    const { job, tossApi, updates } = makeContext([LEFT_OPEN], { ok: true, data: {} });

    expect(await job.closeLeftOpen()).toEqual({ scanned: 1, closed: 1 });
    expect(tossApi.cancelPayment).toHaveBeenCalledWith(
      'pk_va',
      '결제 취소',
      undefined,
      expect.any(String),
      undefined,
      true,
    );
    expect(updates[0]).toEqual(
      expect.objectContaining({ responsePayload: { nextAction: { checkoutMode: 'WIDGET' } } }),
    );
  });

  it('이미 닫힌 계좌는 닫힌 것으로 보고, 다른 실패는 표식을 남겨 다음 주기에 다시 시도한다', async () => {
    const already = makeContext([LEFT_OPEN], { ok: false, error: { code: 'ALREADY_CANCELED_PAYMENT', message: 'x' } });
    expect(await already.job.closeLeftOpen()).toEqual({ scanned: 1, closed: 1 });

    const failing = makeContext([LEFT_OPEN], { ok: false, error: { code: 'PROVIDER_ERROR', message: 'x' } });
    expect(await failing.job.closeLeftOpen()).toEqual({ scanned: 1, closed: 0 });
    // 표식은 남기고 순서만 뒤로 민다.
    expect(failing.updates).toEqual([{ updatedAt: expect.any(Date) }]);
  });
});
