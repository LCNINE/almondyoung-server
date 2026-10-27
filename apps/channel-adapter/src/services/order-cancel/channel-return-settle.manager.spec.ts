import { Logger } from '@nestjs/common';
import type { SettleChannelReturnPayload } from '@packages/event-contracts/streams';
import { ChannelReturnSettleManager } from './channel-return-settle.manager';

const command: SettleChannelReturnPayload = {
  requestId: 'cr-1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  returnId: 'ret_1',
  items: [{ channelOrderItemId: 'ordli_1', received: 1, dismissed: 1 }],
  requestedAt: '2026-10-27T00:00:00.000Z',
};

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordReturnSettlementFailure: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { settleReturn: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelReturnSettleManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

describe('ChannelReturnSettleManager (K8 PR6)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('성공 → 사실 0, Medusa 에 줄·모드를 싣고, 강제 재수집 1', async () => {
    const { manager, repository, medusa, poller } = setup();
    medusa.settleReturn.mockResolvedValue({ kind: 'settled' });
    await manager.execute(command, 'd1');
    expect(medusa.settleReturn).toHaveBeenCalledWith('order_1', 'ret_1', {
      requestId: 'cr-1',
      items: [{ itemId: 'ordli_1', received: 1, dismissed: 1 }],
      refundMode: 'auto',
    });
    expect(repository.recordReturnSettlementFailure).not.toHaveBeenCalled();
    expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it.each([
    [
      'rejected',
      { kind: 'rejected', reason: 'items_mismatch', message: 'm' },
      false,
      false,
      'return_settle_rejected:items_mismatch',
    ],
    [
      'refund_refused',
      { kind: 'refund_refused', failureCode: 'wallet_refund_refused:X', message: 'm' },
      false,
      true,
      'wallet_refund_refused:X',
    ],
    ['refund_pending', { kind: 'refund_pending', message: 'm' }, true, true, 'refund_pending'],
    ['not_found', { kind: 'not_found', message: 'm' }, false, false, 'not_found'],
    ['transient', { kind: 'transient', failureCode: 'http_500', message: 'm' }, true, false, 'http_500'],
  ])('%s → 실패 사실 (retryable=%s received=%s)', async (_n, outcome, retryable, received, failureCode) => {
    const { manager, repository, medusa, poller } = setup();
    medusa.settleReturn.mockResolvedValue(outcome);
    await manager.execute(command, 'd1');
    expect(repository.recordReturnSettlementFailure).toHaveBeenCalledTimes(1);
    const [fact, deliveryId] = repository.recordReturnSettlementFailure.mock.calls[0];
    expect(fact).toMatchObject({
      requestId: 'cr-1',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      returnId: 'ret_1',
      retryable,
      received,
      failureCode,
      message: 'm',
    });
    expect(fact.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deliveryId).toBe('d1');
    expect(poller.syncOrder).not.toHaveBeenCalled();
  });

  it('다른 채널 → channel_not_supported, Medusa 를 부르지 않는다', async () => {
    const { manager, repository, medusa } = setup();
    await manager.execute({ ...command, salesChannel: 'naver' }, 'd1');
    expect(repository.recordReturnSettlementFailure.mock.calls[0][0]).toMatchObject({
      failureCode: 'channel_not_supported',
      retryable: false,
      received: false,
    });
    expect(medusa.settleReturn).not.toHaveBeenCalled();
  });

  it('수집한 적 없는 주문 → order_not_collected', async () => {
    const { manager, repository, medusa } = setup({ mapped: false });
    await manager.execute(command, 'd1');
    expect(repository.recordReturnSettlementFailure.mock.calls[0][0]).toMatchObject({
      failureCode: 'order_not_collected',
      retryable: false,
    });
    expect(medusa.settleReturn).not.toHaveBeenCalled();
  });

  it('사실 적재가 실패하면 던진다 — 재배달을 탄다', async () => {
    const { manager, repository, medusa } = setup();
    medusa.settleReturn.mockResolvedValue({ kind: 'refund_pending', message: 'm' });
    repository.recordReturnSettlementFailure.mockRejectedValue(new Error('db down'));
    await expect(manager.execute(command, 'd1')).rejects.toThrow('db down');
  });
});
