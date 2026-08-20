/* eslint-disable @typescript-eslint/no-unsafe-return */
import { wmsTables } from '../../inventory/schema/inventory.schema';
import {
  EntrancePasswordCleaner,
  expiredEntrancePasswordOrderIds,
  expiredEntrancePasswordShipmentIds,
} from './entrance-password-cleaner';
import { ENTRANCE_PASSWORD_TTL_DAYS } from './entrance-password-expiry';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-21T00:00:00.000Z');
const TTL_MS = ENTRANCE_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;

describe('expiredEntrancePasswordOrderIds', () => {
  it('만료가 지난 주문만 고르고 안 지난 주문은 남긴다', () => {
    expect(
      expiredEntrancePasswordOrderIds(
        [
          { id: A, entrancePasswordExpiresAt: new Date('2026-08-20T23:59:59.000Z') },
          { id: B, entrancePasswordExpiresAt: new Date('2026-08-21T00:00:01.000Z') },
        ],
        NOW,
      ),
    ).toEqual([A]);
  });

  it('만료 시각이 정확히 지금이면 대상이다 — 보관 상한은 포함 경계다', () => {
    expect(expiredEntrancePasswordOrderIds([{ id: A, entrancePasswordExpiresAt: NOW }], NOW)).toEqual([A]);
  });

  it('만료 시각이 없는 행은 건드리지 않는다 — 파기 시점을 판단할 근거가 없다', () => {
    // 프리매처: 이 배치가 아직 오지 않은 배송의 비번을 지워버리면 송장에 현관 정보가
    // 빠진 채 나간다. 판단 근거가 없을 때는 지우지 않는 쪽이 되돌릴 수 있는 실수다.
    expect(expiredEntrancePasswordOrderIds([{ id: A, entrancePasswordExpiresAt: null }], NOW)).toEqual([]);
  });

  it('후보가 없으면 빈 목록이다 — 호출자가 UPDATE 자체를 건너뛴다', () => {
    expect(expiredEntrancePasswordOrderIds([], NOW)).toEqual([]);
  });
});

describe('expiredEntrancePasswordShipmentIds', () => {
  it('주문일을 모르면 상자가 만들어진 시각에 같은 TTL 을 얹어 판정한다', () => {
    expect(
      expiredEntrancePasswordShipmentIds(
        [
          { id: A, createdAt: new Date(NOW.getTime() - TTL_MS), latestOrderDate: null },
          { id: B, createdAt: new Date(NOW.getTime() - TTL_MS + 1), latestOrderDate: null },
        ],
        NOW,
      ),
    ).toEqual([A]);
  });

  it('갓 만들어진 상자는 남는다', () => {
    expect(expiredEntrancePasswordShipmentIds([{ id: A, createdAt: NOW, latestOrderDate: NOW }], NOW)).toEqual([]);
  });

  /**
   * 쇼핑몰이 "늦어도 **주문일**로부터 14일 이내 삭제"를 약속했다. 상자 생성 시각만 보면
   * 13일째 만들어진 상자가 27일째까지 비번을 들고 있게 되고(최악 주문 +28일), 그 약속이
   * 코드에서 거짓이 된다. 상자의 시계는 주문의 시계를 넘지 못한다.
   */
  describe('주문 시계에 묶인다', () => {
    it('상자가 늦게 만들어져도 주문일 +TTL 에 만료한다', () => {
      const orderedAt = new Date(NOW.getTime() - TTL_MS); // 주문일 = 정확히 만료 경계
      const boxCreatedAt = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000); // 상자는 어제
      expect(
        expiredEntrancePasswordShipmentIds([{ id: A, createdAt: boxCreatedAt, latestOrderDate: orderedAt }], NOW),
      ).toEqual([A]);
    });

    it('경계 1ms 전에는 아직 안 지운다', () => {
      const orderedAt = new Date(NOW.getTime() - TTL_MS + 1);
      expect(
        expiredEntrancePasswordShipmentIds([{ id: A, createdAt: NOW, latestOrderDate: orderedAt }], NOW),
      ).toEqual([]);
    });

    it('상자 시계가 더 이르면 그쪽을 쓴다 — 둘 중 빠른 쪽이 상한이다', () => {
      // 주문일이 상자 생성보다 늦는 일은 실제로는 없지만, 규칙은 min 이지 "주문일 우선"이 아니다.
      expect(
        expiredEntrancePasswordShipmentIds(
          [{ id: A, createdAt: new Date(NOW.getTime() - TTL_MS), latestOrderDate: NOW }],
          NOW,
        ),
      ).toEqual([A]);
    });
  });
});

type UpdateCapture = { table: unknown; values?: unknown };

function makeCleaner(selectResults: unknown[][], updateResults: unknown[][] = []) {
  const queuedSelects = [...selectResults];
  const queuedUpdates = [...updateResults];
  const updates: UpdateCapture[] = [];

  const query = (rows: unknown[]) => {
    const builder: any = {
      from: jest.fn(() => builder),
      leftJoin: jest.fn(() => builder),
      where: jest.fn(() => builder),
      groupBy: jest.fn(() => builder),
      orderBy: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };

  const trx: any = {
    select: jest.fn(() => query(queuedSelects.shift() ?? [])),
    update: jest.fn((table: unknown) => {
      const capture: UpdateCapture = { table };
      updates.push(capture);
      const builder: any = {
        set: jest.fn((values: unknown) => {
          capture.values = values;
          return builder;
        }),
        where: jest.fn(() => builder),
        returning: jest.fn(() => Promise.resolve(queuedUpdates.shift() ?? [])),
      };
      return builder;
    }),
  };
  const db = { run: jest.fn((fn: (tx: unknown) => unknown) => fn(trx)) };
  const cleaner = new EntrancePasswordCleaner(db as never);
  return { cleaner, updates, db };
}

describe('EntrancePasswordCleaner.sweepOnce', () => {
  it('만료분의 두 사본을 모두 비우고 지운 건수를 돌려준다', async () => {
    const { cleaner, updates } = makeCleaner(
      [
        [{ id: A, entrancePasswordExpiresAt: new Date('2026-08-01T00:00:00.000Z') }],
        [{ id: B, createdAt: new Date(NOW.getTime() - TTL_MS - 1), latestOrderDate: null }],
      ],
      [[{ id: B }], [{ id: A }]],
    );

    await expect(cleaner.sweepOnce(NOW)).resolves.toEqual({ orders: 1, shipments: 1 });

    expect(updates).toEqual([
      { table: wmsTables.shipments, values: { entrancePassword: null } },
      { table: wmsTables.salesOrders, values: { entrancePassword: null, entrancePasswordExpiresAt: null } },
    ]);
  });

  it('만료가 안 지난 행만 있으면 UPDATE 를 아예 내지 않는다', async () => {
    const { cleaner, updates } = makeCleaner([
      [{ id: A, entrancePasswordExpiresAt: new Date('2026-09-01T00:00:00.000Z') }],
      [{ id: B, createdAt: NOW, latestOrderDate: NOW }],
    ]);

    await expect(cleaner.sweepOnce(NOW)).resolves.toEqual({ orders: 0, shipments: 0 });
    expect(updates).toEqual([]);
  });

  it('지울 것이 없는 스윕을 몇 번이고 다시 돌려도 결과가 같다(멱등)', async () => {
    const { cleaner, updates } = makeCleaner([[], [], [], []]);

    await expect(cleaner.sweepOnce(NOW)).resolves.toEqual({ orders: 0, shipments: 0 });
    await expect(cleaner.sweepOnce(NOW)).resolves.toEqual({ orders: 0, shipments: 0 });
    expect(updates).toEqual([]);
  });
});

/**
 * 위 크론 마운트 테스트는 **자기 테스트 모듈**을 세운다 — 그래서 `SalesOrderModule` 에서
 * 등록을 지워도 그쪽은 초록인 채로 남는다. 이 저장소가 여러 번 데인 모양이 정확히 이것이다
 * ("테스트 초록 ≠ 배선 살아있음"). 그래서 **진짜 모듈의 provider 목록**을 따로 고정한다.
 *
 * DI 컨테이너를 컴파일하지 않고 `@Module` 메타데이터만 읽는다 — 등록 누락을 잡는 데는 그게
 * 필요한 전부이고, 컨테이너를 세우면 DB·Kafka 가 딸려와 기본 게이트에서 못 돌린다.
 */
describe('SalesOrderModule 배선', () => {
  it('EntrancePasswordCleaner 를 provider 로 등록한다 — 안 하면 파기 배치가 영영 안 돈다', async () => {
    // 모듈 그래프가 로드되는 동안 EventsModule 이 kafkajs 설정을 만든다. 실제 브로커에는
    // 붙지 않으므로 값은 아무거나 되고, 토픽 부트스트랩은 꺼 둔다.
    process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
    process.env.KAFKA_BOOTSTRAP_TOPICS = process.env.KAFKA_BOOTSTRAP_TOPICS ?? 'false';

    const { SalesOrderModule } = await import('../sales-order.module');
    // 리플렉션은 본질적으로 `any` 를 돌려준다 — 캐스팅 대신 `unknown` 으로 받아 좁힌다.
    const metadata: unknown = Reflect.getMetadata('providers', SalesOrderModule);
    const providers = Array.isArray(metadata) ? metadata : [];

    expect(providers).toContain(EntrancePasswordCleaner);
  });
});

/**
 * `@Cron` 데코레이터는 그 자체로는 아무 것도 하지 않는다 — 클래스가 Nest 컨테이너의
 * provider 로 등록돼야 `ScheduleModule` 의 `ScheduleExplorer` 가 찾아 실제 cron job 으로
 * 마운트한다. 파기가 "코드에는 있는데 안 도는" 상태로 배포되는 것이 이 태스크의 가장 나쁜
 * 결말이므로 배선 자체를 테스트로 고정한다.
 *
 * 여기서 `ScheduleModule.forRoot()` 를 부르는 것은 격리된 테스트 앱을 세우는 정상 사용이다
 * (#599 가드는 스펙을 제외한다). 프로덕션 배선은 `SCHEDULE_ROOT` 상수 하나를 공유하며,
 * core 에서는 `CoreInventoryModule` 이 이미 그걸 import 하고 있다.
 */
describe('EntrancePasswordCleaner 크론 등록', () => {
  it('ScheduleModule.forRoot() 아래에서 스윕 크론잡이 실제로 마운트된다', async () => {
    const { Test } = await import('@nestjs/testing');
    const { ScheduleModule, SchedulerRegistry } = await import('@nestjs/schedule');
    const { DbService } = await import('@app/db');

    const db = { run: jest.fn(() => Promise.resolve([])) };

    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [EntrancePasswordCleaner, { provide: DbService, useValue: db }],
    }).compile();

    expect(moduleRef.get(SchedulerRegistry).getCronJobs().size).toBe(0);

    await moduleRef.init();

    expect(moduleRef.get(SchedulerRegistry).getCronJobs().size).toBe(1);

    await moduleRef.close();
  });
});
