import { createOrderProvider } from './translating-order.provider';
import { OrderProcessingStageError } from './order-processing-stage.error';
import type { SyncableChannelOrderProvider } from './channel-order-provider.interface';

describe('ReplayableTranslatingOrderProvider.fetchOrderForSync', () => {
  const snapshot = { externalOrderId: 'order_1' };
  const translated = {
    outcome: { kind: 'order', order: { externalOrderId: 'order_1' } },
    lifecycle: [{ eventType: 'OrderCancelled', externalOrderId: 'order_1' }],
  };

  function make(fetched: unknown) {
    const source = { channel: 'medusa', fetchOrders: jest.fn(), fetchOrder: jest.fn().mockResolvedValue(fetched) };
    const translator = { translate: jest.fn().mockResolvedValue(translated) };
    // 테스트 목 — 번역기·source 의 나머지 표면은 이 경로가 쓰지 않는다.
    const provider = createOrderProvider(source as any, translator as any) as SyncableChannelOrderProvider;
    return { provider, source, translator };
  }

  it('번역 결과와 lifecycle 을 함께 돌려준다 — 폴링과 같은 처리를 태우려면 둘 다 필요하다', async () => {
    const { provider, translator } = make(snapshot);
    await expect(provider.fetchOrderForSync('order_1')).resolves.toEqual(translated);
    expect(translator.translate).toHaveBeenCalledWith('medusa', snapshot);
  });

  it('채널에 없으면 null', async () => {
    const { provider, translator } = make(null);
    await expect(provider.fetchOrderForSync('order_1')).resolves.toBeNull();
    expect(translator.translate).not.toHaveBeenCalled();
  });
});

describe('TranslatingOrderProvider.fetchOrders — 주문 단위 실패 (#1016 1번 행)', () => {
  const snapshotA = { externalOrderId: 'A', sourceUpdatedAt: '2026-10-07T01:00:00.000Z', raw: { id: 'A' } };
  const snapshotB = { externalOrderId: 'B', sourceUpdatedAt: '2026-10-07T01:01:00.000Z', raw: { id: 'B' } };
  const orderOf = (externalOrderId: string) => ({
    outcome: { kind: 'order', order: { externalOrderId } },
    lifecycle: [],
  });

  it('스냅샷 하나의 번역이 throw 해도 나머지를 번역하고 그 주문을 translate 실패로 올린다', async () => {
    const source = { channel: 'medusa', fetchOrders: jest.fn().mockResolvedValue([snapshotA, snapshotB]) };
    const translator = {
      translate: jest.fn(async (_channel: string, snapshot: { externalOrderId: string }) => {
        if (snapshot.externalOrderId === 'A') throw new Error('translator broke');
        return orderOf(snapshot.externalOrderId);
      }),
    };
    // 테스트 목 — 번역기·source 의 나머지 표면은 이 경로가 쓰지 않는다.
    const provider = createOrderProvider(source as any, translator as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders.map((order) => order.externalOrderId)).toEqual(['B']);
    expect(result.processingFailures).toEqual([
      {
        externalOrderId: 'A',
        sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
        stage: 'translate',
        error: 'translator broke',
        input: { id: 'A' },
      },
    ]);
  });

  it('창을 쓰는 source 의 조회 실패를 fetch 실패로 옮긴다 — 시각은 채널이 알려 준 변경 시각', async () => {
    const source = {
      channel: 'naver',
      fetchOrders: jest.fn(),
      fetchOrdersInWindow: jest.fn().mockResolvedValue({
        snapshots: [],
        completedWindowEnd: null,
        fetchFailures: [{ externalOrderId: 'ord-2', changedAt: '2026-08-19T01:00:00.000+09:00', error: 'naver 500' }],
      }),
    };
    const provider = createOrderProvider(source as any, { translate: jest.fn() } as any);

    const result = await provider.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result.processingFailures).toEqual([
      {
        externalOrderId: 'ord-2',
        sourceUpdatedAt: '2026-08-19T01:00:00.000+09:00',
        stage: 'fetch',
        error: 'naver 500',
        input: {},
      },
    ]);
  });
});

describe('ReplayableTranslatingOrderProvider.fetchOrderForSync — 번역 실패 단계 (#1016 1번 행)', () => {
  it('번역 throw 는 translate 단계를 실은 OrderProcessingStageError 로 던진다', async () => {
    const original = new Error('translator broke');
    const source = {
      channel: 'medusa',
      fetchOrders: jest.fn(),
      fetchOrder: jest.fn().mockResolvedValue({ externalOrderId: 'A', raw: { id: 'A' } }),
    };
    const translator = { translate: jest.fn().mockRejectedValue(original) };
    const provider = createOrderProvider(source as any, translator as any) as SyncableChannelOrderProvider;

    const error = await provider.fetchOrderForSync('A').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrderProcessingStageError);
    expect(error).toMatchObject({ stage: 'translate', original, input: { id: 'A' }, message: 'translator broke' });
  });
});
