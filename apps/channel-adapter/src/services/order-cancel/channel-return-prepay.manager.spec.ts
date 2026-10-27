import { Logger } from '@nestjs/common';
import type { PrepayChannelReturnPayload } from '@packages/event-contracts/streams';
import { ChannelReturnPrepayManager } from './channel-return-prepay.manager';

const command: PrepayChannelReturnPayload = {
  requestId: 'cr-1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  returnId: 'ret_1',
  amount: 8000,
  refundMode: 'auto',
  memo: '선환불',
  requestedAt: '2026-10-27T00:00:00.000Z',
};

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordReturnPrepayFailure: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { prepayReturn: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelReturnPrepayManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

describe('ChannelReturnPrepayManager (K8 PR6b)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('성공 → 사실 0, Medusa 에 금액·모드·메모를 싣고, 강제 재수집 1', async () => {
    const { manager, repository, medusa, poller } = setup();
    medusa.prepayReturn.mockResolvedValue({ kind: 'prepaid' });
    await manager.execute(command, 'd1');
    expect(medusa.prepayReturn).toHaveBeenCalledWith('order_1', 'ret_1', {
      requestId: 'cr-1',
      amount: 8000,
      refundMode: 'auto',
      memo: '선환불',
    });
    expect(repository.recordReturnPrepayFailure).not.toHaveBeenCalled();
    expect(poller.syncOrder).toHaveBeenCalledTimes(1);
    expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it('금액 없는 명령은 amount 키 없이 보낸다', async () => {
    const { manager, medusa } = setup();
    medusa.prepayReturn.mockResolvedValue({ kind: 'prepaid' });
    const { amount: _amount, ...noAmount } = command;
    await manager.execute(noAmount, 'd1');
    expect(medusa.prepayReturn.mock.calls[0][2]).toEqual({ requestId: 'cr-1', refundMode: 'auto', memo: '선환불' });
  });

  it.each([
    [
      'rejected',
      { kind: 'rejected', reason: 'return_already_settled', message: 'm' },
      false,
      'return_prepay_rejected:return_already_settled',
    ],
    [
      'refund_refused',
      { kind: 'refund_refused', failureCode: 'wallet_refund_refused:X', message: 'm' },
      false,
      'wallet_refund_refused:X',
    ],
    ['refund_pending', { kind: 'refund_pending', message: 'm' }, true, 'refund_pending'],
    ['not_found', { kind: 'not_found', message: 'm' }, false, 'not_found'],
    ['transient', { kind: 'transient', failureCode: 'order_change_open', message: 'm' }, true, 'order_change_open'],
  ])('%s → 실패 사실 (retryable=%s)', async (_n, outcome, retryable, failureCode) => {
    const { manager, repository, medusa, poller } = setup();
    medusa.prepayReturn.mockResolvedValue(outcome);
    await manager.execute(command, 'd1');
    expect(repository.recordReturnPrepayFailure).toHaveBeenCalledTimes(1);
    const [fact, deliveryId] = repository.recordReturnPrepayFailure.mock.calls[0];
    expect(fact).toMatchObject({
      requestId: 'cr-1',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      returnId: 'ret_1',
      retryable,
      failureCode,
      message: 'm',
    });
    expect(fact).not.toHaveProperty('received');
    expect(fact.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deliveryId).toBe('d1');
    expect(poller.syncOrder).not.toHaveBeenCalled();
  });

  it('다른 채널 → channel_not_supported, Medusa 를 부르지 않는다', async () => {
    const { manager, repository, medusa } = setup();
    await manager.execute({ ...command, salesChannel: 'naver' }, 'd1');
    expect(repository.recordReturnPrepayFailure.mock.calls[0][0]).toMatchObject({
      failureCode: 'channel_not_supported',
      retryable: false,
    });
    expect(medusa.prepayReturn).not.toHaveBeenCalled();
  });

  it('수집된 적 없는 주문 → order_not_collected, Medusa 를 부르지 않는다', async () => {
    const { manager, repository, medusa } = setup({ mapped: false });
    await manager.execute(command, 'd1');
    expect(repository.recordReturnPrepayFailure.mock.calls[0][0]).toMatchObject({
      failureCode: 'order_not_collected',
      retryable: false,
    });
    expect(medusa.prepayReturn).not.toHaveBeenCalled();
  });

  it('사실을 못 냈으면 던진다 — 명령을 ack 하지 않고 재배달을 탄다', async () => {
    const { manager, repository, medusa } = setup();
    medusa.prepayReturn.mockResolvedValue({ kind: 'refund_pending', message: 'm' });
    repository.recordReturnPrepayFailure.mockRejectedValue(new Error('outbox down'));
    await expect(manager.execute(command, 'd1')).rejects.toThrow('outbox down');
  });
});
