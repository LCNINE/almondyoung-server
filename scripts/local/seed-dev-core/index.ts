import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbTx, wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';
import { bootstrapScopes } from './scopes';
import { seedMasterData } from './master-data';

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();

  console.log(`── 1/4 dev_core 재생성 (${url})`);
  await recreateDatabase(url);

  console.log('── 2/4 drizzle 마이그레이션');
  runCoreMigrations(url);

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    console.log('── 3/4 스코프 부트스트랩');
    await bootstrapScopes(db);

    console.log(`── 4/4 시드${bulk ? ' (--bulk)' : ''}`);
    await db.transaction(async (trx) => {
      // db 가 typed schema(PostgresJsDatabase<typeof wmsSchema>)로 열려 있어 trx 도 구조적으로
      // DbTx 와 호환되지만, drizzle 의 transaction 콜백 제네릭이 이를 그대로 추론해주지 않는다.
      // logistics-wiring.ts 의 makeDbService 와 동일한 관용구로 좁혀준다.
      await seedMasterData(trx as unknown as DbTx);
    });
  } finally {
    await client.end();
  }

  console.log('✅ dev_core 리셋 완료');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
