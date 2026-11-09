import { DbService } from '@app/db';
import { channelAdapterSchema, reservationProjectionSettings } from '../../schema';
import { ReservationCutoverRepository } from './reservation-cutover.repository';

/**
 * 실행: dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/reservation-projection/reservation-cutover.repository.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReservationCutoverRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let dbService: DbService<typeof channelAdapterSchema>;
  let original: Date | null;
  let repo: ReservationCutoverRepository;

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL as string }, channelAdapterSchema);
    repo = new ReservationCutoverRepository(dbService);
    original = await repo.get(); // 싱글톤 행 — 지우지 않고 끝나면 원래 값으로 되돌린다
  });
  beforeEach(async () => {
    await repo.set(null, 'spec');
  });
  afterAll(async () => {
    await repo.set(original, 'spec-restore');
    await dbService.onApplicationShutdown();
  });

  it('비어 있으면 null', async () => {
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
    const rows = await dbService.db.select().from(reservationProjectionSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedBy).toBe('b');
  });

  it('set(null) 은 비운다', async () => {
    await repo.set(new Date('2026-11-10T00:00:00Z'), 'a');
    await repo.set(null, 'c');
    await expect(repo.get()).resolves.toBeNull();
  });
});
