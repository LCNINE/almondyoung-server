import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { TENANCY_ENV, TENANT_CONTEXT_KEY, TenancyConfig, parseTenantList } from '@app/tenancy';
import { event, stream, type MessageEnvelope } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { OUTBOX_TENANT_ID } from '../outbox/outbox-tenant.port';
import type { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT, type TransportMessage } from '../transport/transport.port';
import { EventTenantStamp } from './event-tenant-stamp';

/**
 * `EventsModule.forApp` 이 앱의 테넌트 설정으로 찍기를 배선한다.
 * 맥락은 CLS 의 `TENANT_CONTEXT_KEY`, T 는 `SERVED_TENANT_ID`(목록과 대조), outbox DB 의 테넌트는 앱이 주는
 * `OUTBOX_TENANT_ID`(core) 이고 없으면 T 다.
 */
const WIRING_STREAM = stream({
  topic: 'tenant-wiring.test.v1',
  aggregateType: 'Thing',
  events: { ThingHappened: event('ThingHappened', z.object({ thingId: z.string() })) },
});

const TENANTS = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

function tenancyModule() {
  @Global()
  @Module({
    providers: [{ provide: TenancyConfig, useValue: new TenancyConfig(TENANTS, 'warn') }],
    exports: [TenancyConfig],
  })
  class FakeTenancyModule {}
  return FakeTenancyModule;
}

function outboxTenantModule(tenantId: string) {
  @Global()
  @Module({ providers: [{ provide: OUTBOX_TENANT_ID, useValue: tenantId }], exports: [OUTBOX_TENANT_ID] })
  class FakeOutboxTenantModule {}
  return FakeOutboxTenantModule;
}

async function compile(extraImports: unknown[] = []) {
  const sent: TransportMessage[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [
      ...(extraImports as never[]),
      EventsModule.forApp({
        publishes: [WIRING_STREAM],
        serviceName: 'wiring',
        kafka: { clientId: 'wiring', brokers: ['localhost:9092'] },
      }),
    ],
  })
    .overrideProvider(EVENT_TRANSPORT)
    .useValue({ send: async (_topic: string, message: TransportMessage) => void sent.push(message) })
    .compile();

  const publisher = moduleRef.get<StreamPublisher<typeof WIRING_STREAM.events>>(
    EventsModule.getPublisherToken(WIRING_STREAM.topic.topic),
  );
  const publish = () =>
    publisher.publishEvent({ eventType: 'ThingHappened', aggregateId: 't-1', payload: { thingId: 't-1' } });
  const tenants = () => sent.map((m) => (JSON.parse(m.value) as MessageEnvelope).metadata?.tenantId);
  return { moduleRef, publish, tenants };
}

describe('EventsModule 의 테넌트 찍기 배선', () => {
  const saved = process.env[TENANCY_ENV.servedTenantId];
  afterEach(() => {
    if (saved === undefined) delete process.env[TENANCY_ENV.servedTenantId];
    else process.env[TENANCY_ENV.servedTenantId] = saved;
  });

  it('맥락이 없으면 SERVED_TENANT_ID 로, CLS 맥락이 있으면 그 테넌트로 찍는다', async () => {
    process.env[TENANCY_ENV.servedTenantId] = '1';
    const { moduleRef, publish, tenants } = await compile([tenancyModule()]);
    const cls = moduleRef.get(ClsService);

    await publish();
    await cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, '2');
      await publish();
    });

    expect(tenants()).toEqual(['1', '2']);
  });

  it('목록에 없는 SERVED_TENANT_ID 면 기동을 거부한다', async () => {
    process.env[TENANCY_ENV.servedTenantId] = '7';

    await expect(compile([tenancyModule()])).rejects.toThrow(/SERVED_TENANT_ID/);
  });

  it('outbox DB 의 테넌트는 앱이 준 OUTBOX_TENANT_ID 이고, T 보다 앞선다', async () => {
    process.env[TENANCY_ENV.servedTenantId] = '1';
    const { moduleRef } = await compile([tenancyModule(), outboxTenantModule('2')]);

    expect(moduleRef.get(EventTenantStamp).forOutboxPublish()).toBe('2');
  });

  it('OUTBOX_TENANT_ID 가 없으면 outbox DB 는 T 의 것이다(T 만 섬기는 앱)', async () => {
    process.env[TENANCY_ENV.servedTenantId] = '1';
    const { moduleRef } = await compile([tenancyModule()]);

    expect(moduleRef.get(EventTenantStamp).forOutboxPublish()).toBe('1');
  });

  it('OUTBOX_TENANT_ID 가 목록에 없으면 기동을 거부한다', async () => {
    await expect(compile([tenancyModule(), outboxTenantModule('7')])).rejects.toThrow(/목록에 없다/);
  });

  it('테넌트 목록이 없는 앱(TenancyModule 미import)은 찍지 않는다 — 옛 동작', async () => {
    process.env[TENANCY_ENV.servedTenantId] = '1';
    const { publish, tenants } = await compile();

    await publish();

    expect(tenants()).toEqual([undefined]);
  });
});
