import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-settings.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentSettingsReader (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  it('default 행을 읽는다', async () => {
    await inRollbackTx(db, async (trx) => {
      await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY, demandRecomputeDays: 21 });
      const reader = new ReplenishmentSettingsReader(boundDbService(trx));
      const settings = await reader.read(trx);
      expect(settings.key).toBe('default');
      expect(settings.demandRecomputeDays).toBe(21);
      expect(settings.adiThreshold).toBe(1.32);
    });
  });

  it('행이 없으면 시드 미실행을 알리는 Error 를 던진다', async () => {
    await inRollbackTx(db, async (trx) => {
      await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      const reader = new ReplenishmentSettingsReader(boundDbService(trx));
      await expect(reader.read(trx)).rejects.toThrow(/db:seed:ref/);
    });
  });
});
