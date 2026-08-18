// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConflictError } from '@app/shared';
import type { DbService } from '@app/db';
import { DbTransaction } from '../../catalog.types';
import {
  SALES_CHANNEL_SITE_UNIQUE_INDEX,
  catalogSchema,
  salesChannels,
  type PimSchema,
} from '../../schema/catalog.schema';
import { SalesChannelsService } from './sales-channels.service';

/**
 * `sales_channels.site` 유일성을 실 Postgres 로 확인한다 (#668 항목 1).
 *
 * DB 없이는 확인할 수 없는 것이 둘이다.
 * 1. 인덱스가 실제로 두 번째 행을 거부하는가.
 * 2. **위반 에러의 `constraint_name` 이 유일 "인덱스" 이름으로 오는가.** 409 매핑이 이
 *    문자열 대조에 걸려 있어서, 여기가 다르면 운영자는 조용히 500 을 받는다.
 *
 * 실행: `npm run test:core:integration:local -- sales-channels.site-unique`
 * 격리: 각 테스트가 트랜잭션을 열어 픽스처를 넣고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('판매채널 site 는 유일하다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: SalesChannelsService;

  beforeAll(() => {
    // Nest DI 를 띄우지 않는다 — channel-listing-lookup.integration.spec.ts 와 같은 이유·같은 형태.
    const connection = postgres(DATABASE_URL as string, { max: 1 });
    sql = connection;
    const drizzleDb = drizzle(connection, { schema: catalogSchema });

    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;

    service = new SalesChannelsService(db);
  });

  afterAll(async () => {
    await sql.end({ timeout: 0 });
  });

  /** 시드·다른 스펙과 겹치지 않는 site 값. 컬럼은 free varchar 라 어휘 밖 값이 들어간다. */
  const uniqueSite = () => `spec-${randomUUID().slice(0, 8)}`;

  async function inRollback(fn: (tx: DbTransaction) => Promise<void>): Promise<void> {
    await expect(
      db.run(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  it('같은 site 의 두 번째 행을 거부하고, 위반을 유일 인덱스 이름으로 보고한다', async () => {
    await inRollback(async (tx) => {
      const site = uniqueSite();
      await tx.insert(salesChannels).values({ site, name: '첫 채널' });

      const failure = await tx
        .insert(salesChannels)
        .values({ site, name: '둘째 채널' })
        .then(() => null)
        .catch((error: unknown) => error);

      expect(failure).not.toBeNull();
      // 최상위가 아니라 `.cause` 에 실제 PostgresError 가 있다 (drizzle 0.44.x 래핑).
      const pgError = ((failure as { cause?: unknown }).cause ?? failure) as {
        code?: string;
        constraint_name?: string;
      };
      expect(pgError.code).toBe('23505');
      expect(pgError.constraint_name).toBe(SALES_CHANNEL_SITE_UNIQUE_INDEX);
    });
  });

  it('createChannel 이 site 중복을 ConflictError 로 바꾼다', async () => {
    await inRollback(async (tx) => {
      const site = uniqueSite();
      await service.createChannel({ site, name: '첫 채널' }, tx);

      await expect(service.createChannel({ site, name: '둘째 채널' }, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('다른 site 는 그대로 들어간다', async () => {
    await inRollback(async (tx) => {
      const first = await service.createChannel({ site: uniqueSite(), name: '채널 A' }, tx);
      const second = await service.createChannel({ site: uniqueSite(), name: '채널 B' }, tx);

      expect(first.id).not.toBe(second.id);
    });
  });
});
