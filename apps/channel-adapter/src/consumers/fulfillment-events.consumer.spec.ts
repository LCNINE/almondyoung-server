import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { FulfillmentEventsConsumer } from './fulfillment-events.consumer';
import { inboxEvents } from '../schema';
import type { FulfillmentShippedPayload, FulfillmentDeliveredPayload } from '@packages/event-contracts/streams';

const SHIPPED_PAYLOAD: FulfillmentShippedPayload = {
  fulfillmentId: 'fo-001',
  orderId: 'order-001',
  channelOrderId: 'ch-001',
  trackingInfo: { carrier: 'CJ', trackingNumber: 'TRK-001' },
  shippedAt: '2026-06-09T00:00:00.000Z',
  shippedItems: [{ fulfillmentItemId: 'foi-001', skuId: 'sku-001', shippedQty: 2 }],
};

const DELIVERED_PAYLOAD: FulfillmentDeliveredPayload = {
  fulfillmentId: 'fo-001',
  orderId: 'order-001',
  channelOrderId: 'ch-001',
  deliveredAt: '2026-06-09T12:00:00.000Z',
};

const ENVELOPE = { correlationId: 'corr-1', messageId: 'msg-1' } as any;

function makeServiceWithAdapter() {
  const valuesMock = jest.fn().mockResolvedValue(undefined);
  const insertMock = jest.fn().mockReturnValue({ values: valuesMock });
  const dbService = { db: { insert: insertMock } };

  const service = new FulfillmentEventsConsumer(dbService as any);
  return { service, insertMock, valuesMock };
}

describe('FulfillmentEventsConsumer.handleFulfillmentShipped', () => {
  it('외부 채널 명령 없이 inbox_events에 full-completion projection만 저장', async () => {
    const { service, insertMock, valuesMock } = makeServiceWithAdapter();
    await service.handleFulfillmentShipped(SHIPPED_PAYLOAD, ENVELOPE);

    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CoreFulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: 'fo-001',
        status: 'pending',
      }),
    );
  });

  it('channel adapter factory 없이도 inbox insert를 수행한다', async () => {
    const { service, insertMock } = makeServiceWithAdapter();
    await service.handleFulfillmentShipped(SHIPPED_PAYLOAD, ENVELOPE);
    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
  });
});

describe('FulfillmentEventsConsumer.handleFulfillmentDelivered', () => {
  it('inbox_events에 CoreFulfillmentDelivered 저장', async () => {
    const { service, insertMock, valuesMock } = makeServiceWithAdapter();
    await service.handleFulfillmentDelivered(DELIVERED_PAYLOAD, ENVELOPE);

    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CoreFulfillmentDelivered',
        aggregateType: 'Fulfillment',
        aggregateId: 'fo-001',
        status: 'pending',
      }),
    );
  });
});

/**
 * core 의 취소를 채널에 되돌려 보내던 역투영을 지웠다(#1016 35번 PR-D, ADR-0042).
 * 채널 쪽 취소는 `CancelChannelOrder` 명령만 낸다 — core 의 취소 «사실» 을 구독해 채널을 부르면
 * 채널이 먼저 한 취소·수정이 채널로 되돌아간다(스펙 §9-9 메아리).
 */
describe('channel-adapter 는 core 의 SalesOrderCancelled 를 구독하지 않는다', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('어느 소스도 SalesOrderCancelled 를 핸들러로 걸지 않는다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders = sourceFiles(srcRoot).filter((file) => /'SalesOrderCancelled'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('CoreOrderCancelled 인박스 행을 적재하는 소스가 없다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders = sourceFiles(srcRoot).filter((file) =>
      /eventType:\s*'CoreOrderCancelled'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
