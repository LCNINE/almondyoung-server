import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { TENANCY_ENV, TENANT_CONTEXT_KEY, parseTenantList } from '@app/tenancy';
import { EventsModule } from '@app/events';
import type { StreamPublisher } from '@app/events/publishers/stream-publisher.service';
import { testTenancyModule } from '@app/events/testing/tenancy';
import { EVENT_TRANSPORT, type TransportMessage } from '@app/events/transport/transport.port';
import { USER_STREAM } from '@packages/event-contracts/streams';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { inAccountTenant } from './account-event-tenant';

// forApp 은 provider 해석 때 Kafka 에 토픽을 만든다 — 브로커 없는 곳에서 재시도하다 타임아웃한다.
jest.mock('@app/events/bootstrap/topic-bootstrap.service', () => ({ bootstrapKafkaTopics: jest.fn(async () => undefined) }));

/**
 * 계정 이벤트 넷은 «계정의 테넌트»로 봉투에 찍힌다 — 실제 `EventsModule` 의 찍기(user-service 는 직접 발행)를 통과시켜 봉투의
 * `metadata.tenantId` 를 본다. 생산자 스펙들은 발행 순간의 맥락만 보므로, 발행 길이 바뀌어(예: outbox) 맥락을 안 보게 되면
 * 여기가 빨개진다.
 */
const TENANTS = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

describe('inAccountTenant — 봉투의 테넌트', () => {
  const saved = process.env[TENANCY_ENV.servedTenantId];
  afterEach(() => {
    if (saved === undefined) delete process.env[TENANCY_ENV.servedTenantId];
    else process.env[TENANCY_ENV.servedTenantId] = saved;
  });

  async function compile() {
    process.env[TENANCY_ENV.servedTenantId] = '1'; // user-service 의 앱 설정 T
    const sent: TransportMessage[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        testTenancyModule('reject', TENANTS),
        EventsModule.forApp({
          publishes: [USER_STREAM],
          serviceName: 'user-service',
          kafka: { clientId: 'account-event-tenant-spec', brokers: ['localhost:9092'] },
        }),
      ],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue({ send: async (_topic: string, message: TransportMessage) => void sent.push(message) })
      .compile();

    const publisher = moduleRef.get<StreamPublisher<typeof USER_STREAM.events>>(
      EventsModule.getPublisherToken(USER_STREAM.topic.topic),
    );
    const withdraw = (userId: string) =>
      publisher.publishEvent({ eventType: 'UserDeleted', aggregateId: userId, payload: { userId } });
    const stamped = () => sent.map((m) => (JSON.parse(m.value) as MessageEnvelope).metadata?.tenantId);
    return { cls: moduleRef.get(ClsService), withdraw, stamped };
  }

  it('맥락 없는 크론에서도 계정의 테넌트로 찍힌다 — T 가 아니다', async () => {
    const { withdraw, stamped } = await compile();

    await inAccountTenant('2', () => withdraw('u-2'));

    expect(stamped()).toEqual(['2']);
  });

  it('다른 테넌트 화면의 요청이어도 계정의 테넌트로 찍고, 같은 요청의 다음 이벤트는 화면의 테넌트로 돌아온다', async () => {
    const { cls, withdraw, stamped } = await compile();

    await cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, '1');
      await inAccountTenant('2', () => withdraw('u-2'));
      await withdraw('u-other');
    });

    expect(stamped()).toEqual(['2', '1']);
  });
});
