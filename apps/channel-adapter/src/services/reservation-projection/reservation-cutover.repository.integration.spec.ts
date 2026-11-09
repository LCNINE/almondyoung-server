// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { channelAdapterSchema, reservationProjectionSettings } from '../../schema';
import { ReservationCutoverRepository } from './reservation-cutover.repository';

/**
 * 실행: dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/reservation-projection/reservation-cutover.repository.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReservationCutoverRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof channelAdapterSchema>>;
  let repo: ReservationCutoverRepository;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: channelAdapterSchema });
    repo = new ReservationCutoverRepository({ db });
  });
  beforeEach(async () => {
    await db.delete(reservationProjectionSettings);
  });
  afterAll(async () => {
    await db.delete(reservationProjectionSettings);
    await client.end();
  });

  it('행이 없으면 null', async () => {
    await expect(repo.get()).resolves.toBeNull();
  });

  it('set 한 값을 get 이 돌려준다', async () => {
    await repo.set(new Date('2026-11-10T00:00:00Z'), 'a');
    await expect(repo.get()).resolves.toEqual(new Date('2026-11-10T00:00:00Z'));
  });

  it('set 을 두 번 하면 마지막 값이고 행은 하나', async () => {
    await repo.set(new Date('2026-11-10T00:00:00Z'), 'a');
    await repo.set(new Date('2026-11-11T00:00:00Z'), 'b');
    await expect(repo.get()).resolves.toEqual(new Date('2026-11-11T00:00:00Z'));
    const rows = await db.select().from(reservationProjectionSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedBy).toBe('b');
  });

  it('set(null) 은 비운다', async () => {
    await repo.set(new Date('2026-11-10T00:00:00Z'), 'a');
    await repo.set(null, 'c');
    await expect(repo.get()).resolves.toBeNull();
  });
});
