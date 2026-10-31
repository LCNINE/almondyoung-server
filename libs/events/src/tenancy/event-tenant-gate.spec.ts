import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { register } from 'prom-client';
import { TENANCY_ENV, TENANT_CONTEXT_KEY, parseTenantList, type TenantGateMode } from '@app/tenancy';
import { getDLQTopicName, type MessageEnvelope } from '@packages/event-contracts/types';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { USER_STREAM } from '@packages/event-contracts/streams/user.stream';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import type { ConsumerTenancy } from './event-tenant-gate';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { testTenancyModule } from '../testing/tenancy';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';

/**
 * 소비 앱의 핸들러 앞 테넌트 문. 실제 `startConsumer` 파이프라인(재시도·DLQ·검증)을 그대로 탄다.
 *
 * - «T 만 섬김»: T 와 다른 테넌트 이벤트는 건너뛰고 센다 — 실패·재시도·DLQ 어디에도 남지 않는다.
 * - «메시지마다»: 테넌트가 목록에 있으면 그 테넌트를 맥락으로 핸들러에 넘긴다.
 * - 테넌트 이벤트인데 테넌트가 없거나 목록에 없으면 ② reject 는 재시도 없이 DLQ, ① warn 은 경고 + 셈 후 처리.
 * - 계정 이벤트는 테넌트와 상관없이 통과한다.
 */
const CART_TOPIC = CART_STREAM.topic.topic;
const USER_TOPIC = USER_STREAM.topic.topic;

const TENANTS = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

interface Call {
  handler: string;
  tenant: string | undefined;
}
const calls: Call[] = [];
let attempts = 0;

@Controller()
@UseInterceptors(EventTypeGuard)
class CartConsumer {
  constructor(private readonly cls: ClsService) {}

  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() _payload: unknown): void {
    attempts += 1;
    calls.push({ handler: 'onCreated', tenant: this.cls.get<string | undefined>(TENANT_CONTEXT_KEY) });
  }
}

@Controller()
@UseInterceptors(EventTypeGuard)
class UserConsumer {
  @On(USER_STREAM, 'UserDeleted')
  onDeleted(@EventPayload() _payload: unknown): void {
    calls.push({ handler: 'onDeleted', tenant: undefined });
  }
}

const kafka = { clientId: 'tenant-gate-spec', brokers: ['unused:9092'] };

function cartEnvelope(id: string, tenantId: string | undefined): MessageEnvelope {
  return {
    messageId: `msg-${id}`,
    messageType: 'CartCreated',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: `corr-${id}`,
    timestamp: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    source: { service: 'other-service', aggregateType: 'Cart', aggregateId: id },
    payload: { id, customerId: 'cust-1', regionId: 'region-1', createdAt: new Date().toISOString() },
    ...(tenantId === undefined ? {} : { metadata: { tenantId } }),
  };
}

function userDeletedEnvelope(id: string, tenantId: string | undefined): MessageEnvelope {
  return {
    messageId: `msg-${id}`,
    messageType: 'UserDeleted',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: `corr-${id}`,
    timestamp: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    source: { service: 'user-service', aggregateType: 'User', aggregateId: id },
    payload: { userId: id },
    ...(tenantId === undefined ? {} : { metadata: { tenantId } }),
  };
}

const fakeTenancy = (mode: TenantGateMode) => testTenancyModule(mode, TENANTS);

async function start(options: {
  mode: TenantGateMode;
  tenancy: ConsumerTenancy;
  servedTenantId?: string;
}): Promise<{ app: INestApplication; broker: InMemoryBroker }> {
  process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
  if (options.servedTenantId === undefined) delete process.env[TENANCY_ENV.servedTenantId];
  else process.env[TENANCY_ENV.servedTenantId] = options.servedTenantId;

  const broker = new InMemoryBroker();
  const moduleRef = await Test.createTestingModule({
    imports: [fakeTenancy(options.mode), EventsModule.forApp({ serviceName: 'tenant-gate-spec', kafka })],
    controllers: [CartConsumer, UserConsumer],
  })
    .overrideProvider(EVENT_TRANSPORT)
    .useValue(new InMemoryTransport(broker))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await EventsModule.startConsumer(app, {
    groupId: 'tenant-gate-spec',
    kafka,
    tenancy: options.tenancy,
    strategy: new InMemoryServer(broker),
  });
  await app.init();
  return { app, broker };
}

async function counter(name: string, labels: Record<string, string>): Promise<number> {
  const metric = register.getSingleMetric(name);
  if (!metric) return 0;
  const values = (await metric.get()).values;
  return values
    .filter((v) => Object.entries(labels).every(([k, value]) => v.labels[k] === value))
    .reduce((sum, v) => sum + v.value, 0);
}

const SKIPPED = 'events_skipped_other_tenant_total';
const UNKNOWN = 'events_consumed_without_known_tenant_total';

let app: INestApplication | undefined;
const savedServed = process.env[TENANCY_ENV.servedTenantId];

afterEach(async () => {
  await app?.close();
  app = undefined;
  calls.length = 0;
  attempts = 0;
});

afterAll(() => {
  if (savedServed === undefined) delete process.env[TENANCY_ENV.servedTenantId];
  else process.env[TENANCY_ENV.servedTenantId] = savedServed;
});

describe.each<TenantGateMode>(['warn', 'reject'])('«T 만 섬김» (T = 1, 모드 %s)', (mode) => {
  let broker: InMemoryBroker;
  beforeEach(async () => {
    ({ app, broker } = await start({ mode, tenancy: 'served-tenant', servedTenantId: '1' }));
  });

  it('T 의 이벤트는 핸들러에 닿고, 맥락은 그 테넌트다', async () => {
    await broker.inject(CART_TOPIC, cartEnvelope(`same-${mode}`, '1'));

    expect(calls).toEqual([{ handler: 'onCreated', tenant: '1' }]);
  });

  it('T 와 다른 테넌트 이벤트는 건너뛰고 센다 — 실패·재시도·DLQ 어디에도 남지 않는다', async () => {
    const before = await counter(SKIPPED, { topic: CART_TOPIC });

    await broker.inject(CART_TOPIC, cartEnvelope(`other-${mode}`, '2'));

    expect(attempts).toBe(0);
    expect(broker.envelopesOn<DLQMessage>(getDLQTopicName(CART_TOPIC))).toHaveLength(0);
    expect(broker.deliveryFailures).toHaveLength(0);
    expect(await counter(SKIPPED, { topic: CART_TOPIC })).toBe(before + 1);
  });
});

describe.each<ConsumerTenancy>(['served-tenant', 'per-message'])('테넌트가 없거나 목록에 없다 (%s)', (tenancy) => {
  const servedTenantId = tenancy === 'served-tenant' ? '1' : undefined;
  const cases: [string, string | undefined, 'missing' | 'unlisted'][] = [
    ['없음', undefined, 'missing'],
    ['목록에 없음', '9', 'unlisted'],
  ];

  it.each(cases)('② reject: %s → 핸들러에 닿지 않고 재시도 없이 DLQ', async (label, tenantId) => {
    let broker: InMemoryBroker;
    ({ app, broker } = await start({ mode: 'reject', tenancy, servedTenantId }));

    await broker.inject(CART_TOPIC, cartEnvelope(`reject-${tenancy}-${label}`, tenantId));

    expect(attempts).toBe(0);
    const dlq = broker.envelopesOn<DLQMessage>(getDLQTopicName(CART_TOPIC));
    expect(dlq.map((m) => m.error.name)).toEqual(['TenantGateRejection']);
    expect(dlq[0].context.retryCount).toBe(1); // 첫 시도 하나 — 재시도 0
    expect(broker.deliveryFailures).toHaveLength(0);
  });

  it.each(cases)('① warn: %s → 경고 + 셈, 맥락 없이 핸들러에 닿는다', async (label, tenantId, reason) => {
    let broker: InMemoryBroker;
    ({ app, broker } = await start({ mode: 'warn', tenancy, servedTenantId }));
    const before = await counter(UNKNOWN, { topic: CART_TOPIC, reason });

    await broker.inject(CART_TOPIC, cartEnvelope(`warn-${tenancy}-${label}`, tenantId));

    expect(calls).toEqual([{ handler: 'onCreated', tenant: undefined }]);
    expect(broker.envelopesOn<DLQMessage>(getDLQTopicName(CART_TOPIC))).toHaveLength(0);
    expect(await counter(UNKNOWN, { topic: CART_TOPIC, reason })).toBe(before + 1);
  });
});

describe('계정 이벤트는 테넌트와 상관없이 통과한다', () => {
  it.each<[ConsumerTenancy, string | undefined, TenantGateMode]>([
    ['served-tenant', '2', 'reject'],
    ['served-tenant', undefined, 'reject'],
    ['per-message', undefined, 'reject'],
    ['served-tenant', '2', 'warn'],
    ['per-message', undefined, 'warn'],
  ])('%s · 봉투 테넌트 %s · %s', async (tenancy, tenantId, mode) => {
    let broker: InMemoryBroker;
    ({ app, broker } = await start({ mode, tenancy, servedTenantId: '1' }));

    await broker.inject(USER_TOPIC, userDeletedEnvelope(`acct-${tenancy}-${String(tenantId)}-${mode}`, tenantId));

    expect(calls.map((c) => c.handler)).toEqual(['onDeleted']);
    expect(broker.envelopesOn<DLQMessage>(getDLQTopicName(USER_TOPIC))).toHaveLength(0);
  });
});

describe('«메시지마다» — 핸들러가 봉투의 테넌트를 맥락으로 받는다', () => {
  it.each<TenantGateMode>(['warn', 'reject'])('테넌트 1·2 를 모두 처리하고 각자의 맥락을 받는다 (%s)', async (mode) => {
    let broker: InMemoryBroker;
    ({ app, broker } = await start({ mode, tenancy: 'per-message' }));

    await broker.inject(CART_TOPIC, cartEnvelope(`pm-1-${mode}`, '1'));
    await broker.inject(CART_TOPIC, cartEnvelope(`pm-2-${mode}`, '2'));

    expect(calls).toEqual([
      { handler: 'onCreated', tenant: '1' },
      { handler: 'onCreated', tenant: '2' },
    ]);
  });
});

describe('기동 거부', () => {
  async function bootWith(options: {
    tenancy: ConsumerTenancy | undefined;
    servedTenantId?: string;
    withTenancyModule?: boolean;
  }): Promise<() => Promise<unknown>> {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    if (options.servedTenantId === undefined) delete process.env[TENANCY_ENV.servedTenantId];
    else process.env[TENANCY_ENV.servedTenantId] = options.servedTenantId;
    const broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...(options.withTenancyModule === false ? [] : [fakeTenancy('reject')]),
        EventsModule.forApp({ serviceName: 'tenant-gate-spec', kafka }),
      ],
      controllers: [CartConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    // as 정당화: 타입이 막는 «선언 없음»을 JS 호출처럼 재현한다
    const startOptions = {
      groupId: 'tenant-gate-spec',
      kafka,
      strategy: new InMemoryServer(broker),
      tenancy: options.tenancy,
    } as Parameters<typeof EventsModule.startConsumer>[1];
    return () => EventsModule.startConsumer(app!, startOptions);
  }

  it('모드 선언이 없으면 거부한다', async () => {
    await expect((await bootWith({ tenancy: undefined }))()).rejects.toThrow(/테넌트 모드가 없거나 틀렸다/);
  });

  it('«T 만 섬김» 인데 T 가 없으면 거부한다', async () => {
    await expect((await bootWith({ tenancy: 'served-tenant' }))()).rejects.toThrow(/SERVED_TENANT_ID 가 없다/);
  });

  it('«T 만 섬김» 인데 T 가 목록에 없으면 거부한다', async () => {
    // T 는 발행 찍기도 읽는다 — 그쪽이 먼저 DI 에서 거부하므로 컴파일 단계에서 던진다
    await expect(bootWith({ tenancy: 'served-tenant', servedTenantId: '9' })).rejects.toThrow(
      /«9» 가 테넌트 목록에 없다/,
    );
  });

  it('테넌트 목록이 없으면 거부한다', async () => {
    await expect((await bootWith({ tenancy: 'per-message', withTenancyModule: false }))()).rejects.toThrow(
      /TenancyModule/,
    );
  });

  it('«메시지마다» 는 T 없이 뜬다', async () => {
    await expect((await bootWith({ tenancy: 'per-message' }))()).resolves.toBeDefined();
  });
});
