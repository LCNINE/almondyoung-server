import { ConfigService } from '@nestjs/config';
import type { UserContactClient } from '@app/shared';
import type { DbService } from '@app/db';
import type { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { CORE_ORDER_STREAM, ORDER_STREAM } from '@packages/event-contracts/streams/orders.stream';
import { Channel, NotificationCategory } from '../../shared/enums';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DemoNotificationProvider } from '../../provider/providers/demo/demo.provider';
import type { ProviderManagerService } from '../../provider/services/provider-manager.service';
import type { TemplateVariableMapperService } from '../../shared/services/template-variable-mapper.service';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { UserNotificationHistoryReader } from '../services/user-notification-history.reader';
import type { EventMappingService } from '../../shared/services/event-mapping.service';
import { OrderEventConsumer } from './order-event.consumer';

const envelope = {
  correlationId: 'demo-correlation-1',
} as EnvelopeOf<typeof ORDER_STREAM, 'OrderCreated'>;

const anonymousOrder = {
  orderId: '4f63b885-1eef-4d8e-a468-80f5ba44b301',
  externalOrderId: 'demo-request-001',
  displayOrderNo: 'DEMO-001',
  salesChannel: 'medusa',
  customerId: null,
  items: [],
  totalAmount: 10_000,
  subtotalAmount: 10_000,
  shippingAmount: 0,
  discountAmount: 0,
  currency: 'KRW',
  shippingAddress: {
    recipientName: '데모 수령인',
    phone: '010-0000-0000',
    postalCode: '06236',
    roadAddress: '서울특별시 강남구 테헤란로 1',
    detailAddress: '데모 1호',
  },
  status: 'confirmed',
  createdAt: '2026-09-16T00:00:00.000Z',
} as EventPayloadOf<typeof ORDER_STREAM, 'OrderCreated'>;

function makeConsumer(env: Record<string, string>, mapping: Record<string, unknown> | null = null) {
  const send: jest.MockedFunction<NotificationDispatcherService['send']> = jest
    .fn()
    .mockResolvedValue({ notificationIds: ['notification-1'] });
  const dispatcher = { send };
  const eventMappings = { getEventMapping: jest.fn().mockResolvedValue(mapping) };
  const contacts = {
    findContacts: jest.fn().mockResolvedValue(
      new Map([
        [
          'user-1',
          {
            userId: 'user-1',
            email: 'looked-up@example.com',
            username: '조회',
            phoneNumber: null,
            marketingConsent: false,
          },
        ],
      ]),
    ),
  };
  const consumer = new OrderEventConsumer(
    dispatcher as unknown as NotificationDispatcherService,
    eventMappings as unknown as EventMappingService,
    new ConfigService(env),
    contacts as unknown as UserContactClient,
  );
  return { consumer, dispatcher, eventMappings, contacts };
}

describe('OrderEventConsumer demo delivery boundary', () => {
  it('sends an anonymous demo order to a reserved recipient through the existing dispatcher', async () => {
    const { consumer, dispatcher, eventMappings } = makeConsumer({
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    });

    await consumer.onOrderCreated(envelope, anonymousOrder);

    expect(eventMappings.getEventMapping).not.toHaveBeenCalled();
    expect(dispatcher.send).toHaveBeenCalledTimes(1);
    const sent = dispatcher.send.mock.calls[0][0];
    expect(sent.userId).toBe(`demo-order:${anonymousOrder.orderId}`);
    expect(sent.channels).toEqual([Channel.EMAIL]);
    expect(sent.category).toBe(NotificationCategory.TRANSACTIONAL);
    expect(sent.eventKey).toBe('DEMO_ORDER_CREATED');
    expect(sent.correlationId).toBe(envelope.correlationId);
    expect(sent.payload).toMatchObject({
      orderId: anonymousOrder.orderId,
      email: 'demo-order@example.invalid',
    });
    expect(sent.content?.EMAIL?.subject).toBe('[DEMO] 주문 접수');
    expect(sent.content?.EMAIL?.body).toContain('DEMO-001');
    expect(sent.metadata).toEqual({
      demo: true,
      simulated: true,
      source: 'demo-order-created',
    });
  });

  it.each([
    { APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'false', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'real' },
  ])('keeps anonymous order notifications skipped outside exact safe demo mode', async (env) => {
    const { consumer, dispatcher, eventMappings } = makeConsumer(env);

    await consumer.onOrderCreated(envelope, anonymousOrder);

    expect(dispatcher.send).not.toHaveBeenCalled();
    expect(eventMappings.getEventMapping).not.toHaveBeenCalled();
  });

  it('preserves the mapped customer notification path outside demo', async () => {
    const mapping = {
      isActive: true,
      defaultChannels: [Channel.EMAIL],
      category: NotificationCategory.TRANSACTIONAL,
      templateKey: 'ORDER_CREATED_EMAIL',
      eventKey: 'ORDER_CREATED',
      priority: 'HIGH',
    };
    const { consumer, dispatcher, eventMappings } = makeConsumer({ APP_STAGE: 'live' }, mapping);
    const customerOrder = { ...anonymousOrder, customerId: 'customer-1' };

    await consumer.onOrderCreated(envelope, customerOrder);

    expect(eventMappings.getEventMapping).toHaveBeenCalledWith('ORDER_CREATED');
    const sent = dispatcher.send.mock.calls[0][0];
    expect(sent.userId).toBe('customer-1');
    expect(sent.templateKey).toBe('ORDER_CREATED_EMAIL');
    expect(sent.eventKey).toBe('ORDER_CREATED');
    expect(sent.payload).toBe(customerOrder);
  });

  it('persists the simulated provider response without invoking a network transport', async () => {
    const updates: Array<Record<string, unknown>> = [];
    let inserted: Record<string, unknown> | undefined;
    const db = {
      query: {
        templates: { findFirst: jest.fn().mockResolvedValue(undefined) },
        notifications: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(inserted)) },
      },
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((values: Record<string, unknown>) => {
          inserted = { notificationId: 'b87083f0-14a5-405f-9d7e-f84d764c4cb8', ...values };
          return { returning: jest.fn().mockResolvedValue([inserted]) };
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((values: Record<string, unknown>) => ({
          where: jest.fn().mockImplementation(() => {
            updates.push(values);
            return Promise.resolve();
          }),
        })),
      }),
    };
    const provider = new DemoNotificationProvider('3b5056a7-d706-4525-b945-f70bff410589', 'Resend Email');
    const dispatcher = new NotificationDispatcherService(
      { db } as unknown as DbService<typeof notificationTables>,
      null,
      { mapVariablesForChannel: jest.fn().mockReturnValue({}) } as unknown as TemplateVariableMapperService,
      {
        getAvailableProviderForChannel: jest.fn().mockResolvedValue(provider),
      } as unknown as ProviderManagerService,
      {} as UserNotificationHistoryReader,
      { getCached: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const eventMappings = { getEventMapping: jest.fn() };
    const consumer = new OrderEventConsumer(
      dispatcher,
      eventMappings as unknown as EventMappingService,
      new ConfigService({
        APP_STAGE: 'demo',
        DEMO_CONSOLE_ENABLED: 'true',
        EXTERNAL_INTEGRATIONS_MODE: 'mock',
      }),
      {} as UserContactClient,
    );
    const transport = jest.spyOn(globalThis, 'fetch');
    const nodeEnv = process.env.NODE_ENV;

    try {
      // Demo deploys with production runtime semantics; provider mocking, not NODE_ENV,
      // is the boundary that prevents transport.
      process.env.NODE_ENV = 'production';
      await consumer.onOrderCreated(envelope, anonymousOrder);
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }

    expect(transport).not.toHaveBeenCalled();
    expect(inserted).toMatchObject({
      userId: `demo-order:${anonymousOrder.orderId}`,
      channel: Channel.EMAIL,
      eventKey: 'DEMO_ORDER_CREATED',
    });
    const sentUpdate = updates.find((update) => update.status === 'SENT');
    expect(sentUpdate).toBeDefined();
    const metadata = sentUpdate?.metadata as { providerResponse?: unknown } | undefined;
    expect(metadata?.providerResponse).toMatchObject({
      simulated: true,
      recipient: 'demo-order@example.invalid',
      subject: '[DEMO] 주문 접수',
    });
  });
});

describe('OrderEventConsumer 발송 완료 알림', () => {
  const shipment = {
    orderId: 'so-1',
    channelOrderId: 'order_01',
    displayOrderNo: '3900',
    customerId: 'user-1',
    customerEmail: 'buyer@example.com',
    customerName: '홍길동',
    dispatchAttemptId: 'attempt-1',
    isPartial: true,
    carrier: 'HANJIN',
    trackingNo: 'TRACK-1',
    dispatchedAt: '2026-09-22T01:00:00.000Z',
  };
  const coreEnvelope = { correlationId: 'c-1' } as EnvelopeOf<typeof CORE_ORDER_STREAM, 'SalesOrderShipmentDispatched'>;
  const mapping = (eventKey: string, isActive = true) => ({
    eventKey,
    isActive,
    defaultChannels: ['EMAIL'],
    category: 'TRANSACTIONAL',
    templateKey: `${eventKey}_EMAIL`,
    priority: 'NORMAL',
  });

  it('부분 발송이면 부분 발송 알림을 활성 회원 메일과 송장 정보로 보낸다', async () => {
    const { consumer, dispatcher, eventMappings } = makeConsumer({}, mapping('ORDER_PARTIALLY_SHIPPED'));

    await consumer.onShipmentDispatched(coreEnvelope, shipment);

    expect(eventMappings.getEventMapping).toHaveBeenCalledWith('ORDER_PARTIALLY_SHIPPED');
    expect(dispatcher.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        payload: expect.objectContaining({ email: 'looked-up@example.com' }),
        variables: { name: '홍길동', orderNumber: '#3900', carrier: '한진택배', trackingNo: 'TRACK-1' },
      }),
    );
  });

  it('전부 나갔으면 발송 완료 알림을 고른다', async () => {
    const { consumer, eventMappings } = makeConsumer({}, mapping('ORDER_SHIPPED'));

    await consumer.onShipmentDispatched(coreEnvelope, { ...shipment, isPartial: false });

    expect(eventMappings.getEventMapping).toHaveBeenCalledWith('ORDER_SHIPPED');
  });

  it('알림이 꺼져 있으면 보내지 않는다', async () => {
    const { consumer, dispatcher } = makeConsumer({}, mapping('ORDER_SHIPPED', false));

    await consumer.onShipmentDispatched(coreEnvelope, { ...shipment, isPartial: false });

    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});

describe('OrderEventConsumer 반품·교환 진행 알림', () => {
  const claim = {
    orderId: 'so-1',
    channelOrderId: 'order_01',
    displayOrderNo: '3900',
    customerId: 'user-1',
    kind: 'exchange' as const,
    stage: 'requested' as const,
    requestId: 'er-1',
    requestedBy: 'customer' as const,
    occurredAt: '2026-09-22T01:00:00.000Z',
  };
  const envelope = { correlationId: 'c-1' } as EnvelopeOf<typeof CORE_ORDER_STREAM, 'SalesOrderClaimProgressed'>;
  const active = (eventKey: string) => ({
    eventKey,
    isActive: true,
    defaultChannels: ['EMAIL'],
    category: 'TRANSACTIONAL',
    templateKey: `${eventKey}_EMAIL`,
    priority: 'NORMAL',
  });

  it.each([
    [{ stage: 'requested', requestedBy: 'customer' }, 'CLAIM_REQUESTED'],
    [{ stage: 'requested', requestedBy: 'admin' }, 'CLAIM_RECEIVED'],
    [{ stage: 'collected' }, 'CLAIM_COLLECTED'],
    [{ stage: 'completed' }, 'CLAIM_COMPLETED'],
  ])('%o 는 %s 알림을 고른다', async (override, eventKey) => {
    const { consumer, eventMappings } = makeConsumer({}, active(eventKey));

    await consumer.onClaimProgressed(envelope, { ...claim, ...override } as typeof claim);

    expect(eventMappings.getEventMapping).toHaveBeenCalledWith(eventKey);
  });

  it('주문에 적힌 메일이 아니라 활성 회원 메일로 보낸다', async () => {
    const { consumer, dispatcher } = makeConsumer({}, active('CLAIM_REQUESTED'));

    await consumer.onClaimProgressed(envelope, { ...claim, customerEmail: 'old-order@example.com' });

    expect(dispatcher.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ email: 'looked-up@example.com' }),
        variables: { name: '고객', orderNumber: '#3900', claimType: '교환' },
      }),
    );
  });

  it('탈퇴·휴면으로 활성 연락처가 없으면 주문에 메일이 있어도 보내지 않는다', async () => {
    const { consumer, dispatcher, contacts } = makeConsumer({}, active('CLAIM_COLLECTED'));
    contacts.findContacts.mockResolvedValue(new Map());

    await consumer.onClaimProgressed(envelope, {
      ...claim,
      stage: 'collected',
      customerEmail: 'old-order@example.com',
    });

    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});
