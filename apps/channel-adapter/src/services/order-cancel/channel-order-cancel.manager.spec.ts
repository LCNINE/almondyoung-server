// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { Logger } from '@nestjs/common';
import { ChannelOrderCancelManager } from './channel-order-cancel.manager';

const full: CancelChannelOrderPayload = {
  requestId: 'req-1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  scope: 'full',
  requestedBy: 'operator',
  requestedAt: '2026-10-07T00:00:00.000Z',
};
const partial: CancelChannelOrderPayload = { ...full, scope: 'partial', lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }] };
const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordRejected: jest.fn().mockResolvedValue(undefined),
    recordStalled: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { cancelOrder: jest.fn(), partialCancelOrder: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelOrderCancelManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

describe('ChannelOrderCancelManager (#1016 35번 PR-B)', () => {
  it.each(['naver', 'coupang', '3pl', 'cafe24'])('자동 취소 불가 채널(%s)은 NOT_SUPPORTED — 채널을 부르지 않는다', async (salesChannel) => {
    const { manager, repository, medusa, poller } = setup();
    await manager.execute({ ...full, salesChannel }, 'd1');
    expect(repository.recordRejected).toHaveBeenCalledWith(expect.objectContaining({ salesChannel, reasonCode: 'NOT_SUPPORTED' }), 'd1');
    expect(repository.hasCollectedOrder).not.toHaveBeenCalled();
    expect(medusa.cancelOrder).not.toHaveBeenCalled();
    expect(poller.syncOrder).not.toHaveBeenCalled();
  });

  it('수집한 적 없는 주문은 ORDER_NOT_FOUND', async () => {
    const { manager, repository, medusa } = setup({ mapped: false });
    await manager.execute(full, 'd1');
    expect(repository.recordRejected).toHaveBeenCalledWith(expect.objectContaining({ ...key, reasonCode: 'ORDER_NOT_FOUND' }), 'd1');
    expect(medusa.cancelOrder).not.toHaveBeenCalled();
  });

  it.each(['channel_inactive', 'not_found'])('취소 뒤 재수집이 %s 면 warn 으로 남긴다 — 돌아가는 사실이 없다', async (outcome) => {
    const { manager, medusa, poller } = setup();
    medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
    poller.syncOrder.mockResolvedValue({ outcome });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      await manager.execute(full, 'd1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`재수집 ${outcome}`));
      expect(log).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  describe('전체취소', () => {
    it.each([{ kind: 'cancelled' }, { kind: 'already_cancelled' }])('$kind 면 거절 없이 즉시 재수집한다', async (outcome) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1');
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });

    it.each([
      [{ kind: 'not_found', message: 'gone' }, 'ORDER_NOT_FOUND'],
      [{ kind: 'not_cancelable', message: 'fulfilled' }, 'NOT_CANCELABLE'],
    ])('%o 는 %s 거절이고 재수집하지 않는다', async (outcome, reasonCode) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      expect(repository.recordRejected).toHaveBeenCalledWith({ ...key, reasonCode, message: (outcome as { message: string }).message }, 'd1');
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('Medusa 500 은 던진다 — wallet «환불 불가»도 여기로 온다(REFUND_FAILED 미판별). 거절 사실을 내지 않는다', async () => {
      const { manager, repository, medusa } = setup();
      medusa.cancelOrder.mockRejectedValue(new Error('Medusa cancelOrder failed (status=500): An unknown error occurred.'));
      await expect(manager.execute(full, 'd1')).rejects.toThrow('status=500');
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });

    it('취소는 됐는데 재수집이 실패하면 던진다 — 재시도의 취소는 «이미 취소됨»이라 멱등이다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockRejectedValue(new Error('Medusa retrieveOrder failed'));
      await expect(manager.execute(full, 'd1')).rejects.toThrow('retrieveOrder');
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });
  });

  describe('부분취소', () => {
    it('requestId 와 Medusa 줄 id·취소할 수량을 넘기고, 성공이면 재수집한다', async () => {
      const { manager, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'cancelled', refundAmount: 1000, shippingDelta: 0, shippingNotAdjusted: false });
      await manager.execute(partial, 'd1');
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', { requestId: 'req-1', items: [{ itemId: 'ordli_1', quantity: 2 }] });
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
    });

    it('정해진 거절은 NOT_CANCELABLE', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'rejected', message: '수량 초과' });
      await manager.execute(partial, 'd1');
      expect(repository.recordRejected).toHaveBeenCalledWith({ ...key, reasonCode: 'NOT_CANCELABLE', message: '수량 초과' }, 'd1');
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('환불 미완이면 정체 사실을 «먼저» 내고 던진다 — 거절도 재수집도 없다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_pending', message: 'PG down' });
      await expect(manager.execute(partial, 'd1')).rejects.toThrow(/req-1/);
      expect(repository.recordStalled).toHaveBeenCalledWith({ ...key, stage: 'edited', message: 'PG down' }, 'd1');
      expect(repository.recordRejected).not.toHaveBeenCalled();
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('줄 없는 부분취소가 스키마를 뚫고 오면 던진다 — 빈 요청을 Medusa 에 보내지 않는다', async () => {
      const { manager, medusa } = setup();
      await expect(manager.execute({ ...partial, lines: undefined }, 'd1')).rejects.toThrow();
      expect(medusa.partialCancelOrder).not.toHaveBeenCalled();
    });
  });
});
