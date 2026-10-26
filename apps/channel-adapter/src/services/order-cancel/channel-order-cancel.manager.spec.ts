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
const partial: CancelChannelOrderPayload = {
  ...full,
  scope: 'partial',
  lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }],
};
const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordSettlementFailure: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { cancelOrder: jest.fn(), partialCancelOrder: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelOrderCancelManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

/** recordSettlementFailure 의 [사실, 전달 id] */
function recorded(repository: ReturnType<typeof setup>['repository']) {
  expect(repository.recordSettlementFailure).toHaveBeenCalledTimes(1);
  const [fact, deliveryId] = repository.recordSettlementFailure.mock.calls[0];
  return { fact, deliveryId };
}

const cancelledPartial = { kind: 'cancelled', refundAmount: 0, shippingDelta: 0, shippingNotAdjusted: false };

describe('ChannelOrderCancelManager (#1016 35번 PR-B · 36번 재설계 PR 3)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('사전검사', () => {
    it.each(['naver', 'coupang', '3pl', 'cafe24'])(
      '자동 취소 불가 채널(%s)은 영구 정산 실패 — 채널을 부르지 않는다',
      async (salesChannel) => {
        const { manager, repository, medusa, poller } = setup();
        await manager.execute({ ...full, salesChannel }, 'd1');
        const { fact } = recorded(repository);
        expect(fact).toMatchObject({ salesChannel, retryable: false, failureCode: 'channel_not_supported', scope: 'full' });
        expect(repository.hasCollectedOrder).not.toHaveBeenCalled();
        expect(medusa.cancelOrder).not.toHaveBeenCalled();
        expect(poller.syncOrder).not.toHaveBeenCalled();
      },
    );

    it('수집한 적 없는 주문은 영구 정산 실패 order_not_collected', async () => {
      const { manager, repository, medusa } = setup({ mapped: false });
      await manager.execute(full, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ ...key, retryable: false, failureCode: 'order_not_collected' });
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('refundMode 전달', () => {
    it('명령에 없으면 auto 로 보낸다 — 옛 core 의 명령이다', async () => {
      const { manager, medusa } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute(full, 'd1');
      await manager.execute(partial, 'd2');
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1', { refundMode: 'auto' });
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', {
        requestId: 'req-1',
        items: [{ itemId: 'ordli_1', quantity: 2 }],
        refundMode: 'auto',
        requestedBy: 'operator',
      });
    });

    it('manual 은 그대로, 같은 requestId 로 보낸다 — Medusa 가 같은 요청의 환불을 한 번으로 접는다', async () => {
      const { manager, medusa } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute({ ...full, refundMode: 'manual' }, 'd1');
      await manager.execute({ ...partial, refundMode: 'manual', alreadyRefundedAmount: 10000 }, 'd2');
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1', { refundMode: 'manual' });
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', {
        requestId: 'req-1',
        items: [{ itemId: 'ordli_1', quantity: 2 }],
        alreadyRefunded: 10000,
        refundMode: 'manual',
        requestedBy: 'operator',
      });
    });
  });

  describe('취소 사유 전달 (K8 — 택배비는 사유가 정한다)', () => {
    it('명령의 reasonCode·requestedBy 를 부분취소 입력으로 그대로 넘긴다', async () => {
      const { manager, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute({ ...partial, reasonCode: 'OUT_OF_STOCK', requestedBy: 'operator' }, 'd1');
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith(
        'order_1',
        expect.objectContaining({ reasonCode: 'OUT_OF_STOCK', requestedBy: 'operator' }),
      );
    });

    it('사유가 명령에 없으면 reasonCode 키를 싣지 않는다', async () => {
      const { manager, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute(partial, 'd1');
      expect(medusa.partialCancelOrder.mock.calls[0][1]).not.toHaveProperty('reasonCode');
    });
  });

  describe('전체취소', () => {
    it.each([{ kind: 'cancelled' }, { kind: 'already_cancelled' }])('$kind 면 사실 없이 즉시 재수집한다', async (outcome) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it('wallet 영구 거절은 영구 정산 실패', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
      });
      await manager.execute(full, 'd1');
      const { fact, deliveryId } = recorded(repository);
      expect(fact).toEqual({
        ...key,
        scope: 'full',
        retryable: false,
        failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
        at: expect.stringMatching(ISO),
      });
      expect(deliveryId).toBe('d1');
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it.each([
      [{ kind: 'not_found', message: 'gone' }, 'not_found'],
      [{ kind: 'not_cancelable', failureCode: 'not_allowed', message: 'fulfilled' }, 'not_allowed'],
    ])('%o 는 영구 정산 실패 %s, 재수집하지 않는다', async (outcome, failureCode) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode, message: outcome.message });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it.each(['http_500', 'http_404', 'network'])(
      '일시 실패 %s 는 사실을 내고 ack 한다 — 다시 부르는 건 core 리컨실러(PR 6)',
      async (failureCode) => {
        const { manager, repository, medusa, poller } = setup();
        medusa.cancelOrder.mockResolvedValue({ kind: 'transient', failureCode, message: 'down' });
        await expect(manager.execute(full, 'd1')).resolves.toBeUndefined();
        const { fact } = recorded(repository);
        expect(fact).toMatchObject({ retryable: true, failureCode, message: 'down', scope: 'full' });
        expect(poller.syncOrder).not.toHaveBeenCalled();
      },
    );

    it('일시 실패는 사실을 낸 뒤 ack 한다 — 다시 부르는 건 core 리컨실러 하나(스펙 S7, PR 6)', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'transient', failureCode: 'http_502', message: 'bad gateway' });
      await expect(manager.execute(full, 'd1')).resolves.toBeUndefined();
      expect(recorded(repository).fact).toMatchObject({ retryable: true, failureCode: 'http_502' });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('취소는 됐는데 재수집이 실패하면 던진다 — 재시도의 취소는 «이미 취소됨»이라 멱등이다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockRejectedValue(new Error('Medusa retrieveOrder failed'));
      await expect(manager.execute(full, 'd1')).rejects.toThrow('retrieveOrder');
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it.each(['channel_inactive', 'not_found'])('취소 뒤 재수집이 %s 면 warn 으로 남긴다 — 돌아가는 사실이 없다', async (outcome) => {
      const { manager, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockResolvedValue({ outcome });
      await manager.execute(full, 'd1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`재수집 ${outcome}`));
    });
  });

  describe('부분취소', () => {
    it('성공이면 사실 없이 재수집한다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ ...cancelledPartial, refundAmount: 1000 });
      await manager.execute(partial, 'd1');
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it('정해진 거절은 영구 정산 실패 partial_cancel_rejected', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'rejected', message: '수량 초과' });
      await manager.execute(partial, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: false, failureCode: 'partial_cancel_rejected', message: '수량 초과' });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('외부 환불 거절은 영구 정산 실패(사유 그대로) — 라이브 37번 흐름이 그대로 산다', async () => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'external_refund',
        reason: 'external_refund_unresolved',
        message: '외부 환불 10,000원',
        unresolvedAmount: 10000,
      });
      await manager.execute(partial, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode: 'external_refund_unresolved', message: '외부 환불 10,000원' });
    });

    it('수정 뒤 wallet 영구 거절은 영구 정산 실패 — 던지지 않는다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT',
        message: '이미 취소된 결제입니다',
        edited: true,
      });
      await manager.execute(partial, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: false, failureCode: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT' });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });


    it('환불 미완(502)은 일시 정산 실패 refund_pending 를 내고 ack 한다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_pending', message: 'PG down' });
      await expect(manager.execute(partial, 'd1')).resolves.toBeUndefined();
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ retryable: true, failureCode: 'refund_pending', message: 'PG down' });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('Medusa 자신의 거절은 영구 정산 실패 + ack', async () => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'not_cancelable',
        failureCode: 'not_allowed',
        message: 'Order order_1 already has an existing active order change',
      });
      await manager.execute(partial, 'd1');
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode: 'not_allowed' });
    });

    it.each(['http_502', 'http_404', 'network'])('일시 실패 %s 는 사실을 낸 뒤 ack 한다', async (failureCode) => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'transient', failureCode, message: 'down' });
      await expect(manager.execute(partial, 'd1')).resolves.toBeUndefined();
      const { fact } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: true, failureCode });
    });

    it('줄 없는 부분취소가 스키마를 뚫고 오면 던진다 — 빈 요청을 Medusa 에 보내지 않는다', async () => {
      const { manager, medusa } = setup();
      await expect(manager.execute({ ...partial, lines: undefined }, 'd1')).rejects.toThrow();
      expect(medusa.partialCancelOrder).not.toHaveBeenCalled();
    });
  });

  it('사실 적재가 실패하면 영구 실패라도 던진다 — ack 하지 않고 재배달을 탄다', async () => {
    const { manager, repository, medusa } = setup();
    medusa.cancelOrder.mockResolvedValue({ kind: 'not_found', message: 'gone' });
    repository.recordSettlementFailure.mockRejectedValue(new Error('outbox down'));
    await expect(manager.execute(full, 'd1')).rejects.toThrow('outbox down');
  });
});
