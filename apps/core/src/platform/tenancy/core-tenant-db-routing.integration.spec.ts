import * as postgres from 'postgres';
import { sql as raw } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { connectionStringFor, DbService } from '@app/db';
import { parseTenantList, TENANT_CONTEXT_KEY, TenancyConfig } from '@app/tenancy';
import { coreTenantDbRouter, TenantContextMissingError, TenantNotListedError } from './core-tenant-db-router';

/**
 * core 의 테넌트 라우팅을 실 Postgres 두 DB 로 본다 — 「맥락 A 의 쓰기가 B 에서 안 보인다」는 풀이 정말 다른 DB 에
 * 붙었는지로만 확인된다.
 *
 * 실행: `npm run test:core:integration:local -- core-tenant-db-routing`
 * 스펙이 스크래치 DB 둘을 만들고 끝나면 지운다. 접속 정보는 DATABASE_URL 의 것을 쓴다(DB 이름만 바꾼다).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const probe = pgTable('tenant_routing_probe', { note: text('note').notNull() });
const schema = { probe };

const DB_A = 'tenant_routing_probe_a';
const DB_B = 'tenant_routing_probe_b';

const tenants = parseTenantList(
  JSON.stringify([
    { id: 'a', slug: 'alpha', coreDb: DB_A, publicBucket: 'bucket-a', privateBucket: 'bucket-a' },
    { id: 'b', slug: 'beta', coreDb: DB_B, publicBucket: 'bucket-b-pub', privateBucket: 'bucket-b-priv' },
  ]),
);

const urlOf = (database: string): string => connectionStringFor(DATABASE_URL ?? '', database);

describeIfDb('core 테넌트 라우팅 (실 Postgres 두 DB)', () => {
  jest.setTimeout(60_000);

  let admin: postgres.Sql;
  let cls: ClsService;
  let db: DbService<typeof schema>;

  const inTenant = <T>(tenant: string | undefined, fn: () => Promise<T>): Promise<T> =>
    // 실제 호출처처럼 async 함수 안에서 닿는다 — 라우터의 거절이 rejection 으로 나온다.
    cls.run(async () => {
      if (tenant !== undefined) cls.set(TENANT_CONTEXT_KEY, tenant);
      return fn();
    });

  const notesIn = async (database: string): Promise<string[]> => {
    const client = postgres(urlOf(database), { max: 1, onnotice: () => undefined });
    try {
      const rows = await client<{ note: string }[]>`SELECT note FROM tenant_routing_probe ORDER BY note`;
      return rows.map((r) => r.note);
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    admin = postgres(urlOf('postgres'), { max: 1, onnotice: () => undefined });
    for (const name of [DB_A, DB_B]) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const client = postgres(urlOf(name), { max: 1, onnotice: () => undefined });
      await client`CREATE TABLE tenant_routing_probe (note text NOT NULL)`;
      await client.end();
    }

    cls = ClsServiceManager.getClsService();
    const router = coreTenantDbRouter(new TenancyConfig(tenants, 'reject'), cls);
    // DATABASE_URL 이 가리키는 DB 는 라우팅에 쓰이지 않는다 — 풀은 목록의 coreDb 로 붙는다.
    db = new DbService({ connectionString: urlOf('postgres') }, schema, router);
  });

  afterAll(async () => {
    await db?.onApplicationShutdown();
    for (const name of [DB_A, DB_B]) await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    for (const name of [DB_A, DB_B]) {
      const client = postgres(urlOf(name), { max: 1, onnotice: () => undefined });
      await client`TRUNCATE tenant_routing_probe`;
      await client.end();
    }
  });

  it('맥락 A 의 쓰기는 A 의 DB 에만 있고 B 에서 안 보인다', async () => {
    await inTenant('a', () => db.db.insert(probe).values({ note: 'from-a' }));
    await inTenant('b', () => db.run((tx) => tx.insert(probe).values({ note: 'from-b' })));

    expect(await notesIn(DB_A)).toEqual(['from-a']);
    expect(await notesIn(DB_B)).toEqual(['from-b']);
    expect(await inTenant('b', () => db.db.select().from(probe))).toEqual([{ note: 'from-b' }]);
  });

  it('맥락이 없으면 DB 에 닿기 전에 실패한다 — 기본 테넌트로 떨어지지 않는다', async () => {
    await expect(inTenant(undefined, () => db.db.select().from(probe))).rejects.toThrow(TenantContextMissingError);
    // CLS 맥락 자체가 없는 곳(크론·outbox·부팅 훅)도 같다.
    expect(() => db.db).toThrow(TenantContextMissingError);
    await expect(db.run(async (tx) => tx.select().from(probe))).rejects.toThrow(TenantContextMissingError);
  });

  it('목록에 없는 테넌트 맥락은 실패한다', async () => {
    await expect(inTenant('zzz', () => db.db.select().from(probe))).rejects.toThrow(TenantNotListedError);
  });

  it('트랜잭션 전파(run(fn, tx))는 연 풀에 머문다 — 안에서 맥락이 바뀌어도 tx 가 이긴다', async () => {
    await inTenant('a', () =>
      db.run(async (tx) => {
        await tx.insert(probe).values({ note: 'outer' });
        cls.set(TENANT_CONTEXT_KEY, 'b');
        await db.run((inner) => inner.insert(probe).values({ note: 'propagated' }), tx);
      }),
    );

    expect(await notesIn(DB_A)).toEqual(['outer', 'propagated']);
    expect(await notesIn(DB_B)).toEqual([]);
  });

  it('① (warn) 은 라우터 없이 DATABASE_URL 하나를 쓴다 — 맥락이 무엇이든, 없어도 같은 DB 다', async () => {
    expect(coreTenantDbRouter(new TenancyConfig(tenants, 'warn'), cls)).toBeNull();
    const single = new DbService(
      { connectionString: urlOf(DB_A) },
      schema,
      coreTenantDbRouter(new TenancyConfig(tenants, 'warn'), cls),
    );
    try {
      await inTenant('b', () => single.db.insert(probe).values({ note: 'ctx-b' }));
      await single.db.insert(probe).values({ note: 'no-ctx' });
    } finally {
      await single.onApplicationShutdown();
    }

    expect(await notesIn(DB_A)).toEqual(['ctx-b', 'no-ctx']);
    expect(await notesIn(DB_B)).toEqual([]);
  });

  it('세션 단위 SET 을 쓰지 않는다 — 두 풀이 각자의 DB 에 붙어 있다', async () => {
    const [a] = await inTenant('a', () => db.db.execute<{ db: string }>(raw`SELECT current_database() AS db`));
    const [b] = await inTenant('b', () => db.db.execute<{ db: string }>(raw`SELECT current_database() AS db`));
    expect([a.db, b.db]).toEqual([DB_A, DB_B]);
  });
});
