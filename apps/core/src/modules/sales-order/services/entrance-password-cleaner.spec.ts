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
  it('상자 사본은 만들어진 시각에 같은 TTL 을 얹어 판정한다', () => {
    expect(
      expiredEntrancePasswordShipmentIds(
        [
          { id: A, createdAt: new Date(NOW.getTime() - TTL_MS) },
          { id: B, createdAt: new Date(NOW.getTime() - TTL_MS + 1) },
        ],
        NOW,
      ),
    ).toEqual([A]);
  });

  it('갓 만들어진 상자는 남는다', () => {
    expect(expiredEntrancePasswordShipmentIds([{ id: A, createdAt: NOW }], NOW)).toEqual([]);
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
      where: jest.fn(() => builder),
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
        [{ id: B, createdAt: new Date(NOW.getTime() - TTL_MS - 1) }],
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
      [{ id: B, createdAt: NOW }],
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
