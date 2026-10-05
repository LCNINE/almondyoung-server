import { createOrderProvider } from './translating-order.provider';
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
