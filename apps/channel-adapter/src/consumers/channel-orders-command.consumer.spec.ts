import { readFileSync } from 'fs';
import { join } from 'path';
import { ChannelOrdersCommandConsumer } from './channel-orders-command.consumer';
import type { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import type { ChannelOrderCancelManager } from '../services/order-cancel/channel-order-cancel.manager';

const envelope = { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as never;

function consumerWith(syncOrder: jest.Mock, execute: jest.Mock = jest.fn()) {
  return new ChannelOrdersCommandConsumer(
    { syncOrder } as unknown as OrderPollerOrchestrator,
    { execute } as unknown as ChannelOrderCancelManager,
  );
}

describe('ChannelOrdersCommandConsumer — ResyncChannelOrder (#1016 6번 행)', () => {
  it('지원 채널이면 force 로 즉시 끌어오기를 탄다', async () => {
    const syncOrder = jest.fn().mockResolvedValue({ outcome: 'emitted' });
    await consumerWith(syncOrder).handleResync(
      { salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' },
      envelope,
    );
    expect(syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it.each(['3pl', 'coupang', 'unknown'])('지원하지 않는 채널(%s)은 부르지도 던지지도 않는다', async (salesChannel) => {
    const syncOrder = jest.fn();
    await expect(
      consumerWith(syncOrder).handleResync({ salesChannel, externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
    ).resolves.toBeUndefined();
    expect(syncOrder).not.toHaveBeenCalled();
  });

  it.each(['channel_inactive', 'not_found', 'not_eligible', 'identification_failed', 'unchanged'])(
    '결과가 %s 여도 던지지 않는다 — 재시도해도 같다',
    async (outcome) => {
      const syncOrder = jest.fn().mockResolvedValue({ outcome });
      await expect(
        consumerWith(syncOrder).handleResync({ salesChannel: 'naver', externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
      ).resolves.toBeUndefined();
    },
  );

  it('예상 밖 예외(채널 API 5xx 등)는 던진다 — 재시도·DLQ 를 탄다', async () => {
    const syncOrder = jest.fn().mockRejectedValue(new Error('Request failed with status code 503'));
    await expect(
      consumerWith(syncOrder).handleResync({ salesChannel: 'medusa', externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
    ).rejects.toThrow('503');
  });

  it('adapter.module 의 controllers 에 등록돼 있다 — 빠지면 구독이 조용히 안 된다', () => {
    const source = readFileSync(join(__dirname, '..', 'adapter.module.ts'), 'utf8');
    const controllers = source.slice(source.indexOf('controllers: ['));
    expect(controllers).toMatch(/\bChannelOrdersCommandConsumer\b/);
  });
});

describe('ChannelOrdersCommandConsumer — CancelChannelOrder (#1016 35번 행)', () => {
  const command = {
    requestId: 'req-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_1',
    scope: 'full' as const,
    requestedBy: 'operator' as const,
    requestedAt: '2026-10-07T00:00:00.000Z',
  };

  it('명령을 실행기에 그대로 넘긴다', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    await consumerWith(jest.fn(), execute).handleCancel(command, envelope);
    expect(execute).toHaveBeenCalledWith(command);
  });

  it('실행기의 예외는 삼키지 않는다 — 재시도·DLQ 를 탄다', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('Medusa cancelOrder failed (status=503)'));
    await expect(consumerWith(jest.fn(), execute).handleCancel(command, envelope)).rejects.toThrow('503');
  });

  it('실행기·리포지토리가 adapter.module providers 에 등록돼 있다 — 빠지면 부팅 DI 가 죽는다', () => {
    const source = readFileSync(join(__dirname, '..', 'adapter.module.ts'), 'utf8');
    const providers = source.slice(source.indexOf('providers: ['));
    expect(providers).toMatch(/\bChannelOrderCancelManager\b/);
    expect(providers).toMatch(/\bChannelOrderCancelRepository\b/);
  });
});
