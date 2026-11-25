import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { DbTx, wmsSchema } from '../../schema/inventory.schema';
import type { WorkshopActor } from '../workshop-access';

export type WorkshopTestDb = {
  container: StartedPostgreSqlContainer;
  client: postgres.Sql;
  db: PostgresJsDatabase<typeof wmsSchema>;
  dbService: DbService<typeof wmsSchema>;
};

// 전용 컨테이너에 core 마이그레이션 전체를 적용한다 — 로컬 데이터와 격리
export async function startWorkshopDb(): Promise<WorkshopTestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const client = postgres(container.getConnectionUri(), { max: 10, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  await migrate(db, {
    migrationsFolder: join(__dirname, '../../../../../drizzle'),
    migrationsSchema: 'public',
  });

  const dbService = {
    db,
    run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
  } as unknown as DbService<typeof wmsSchema>;

  return { container, client, db, dbService };
}

export async function seedSku(db: PostgresJsDatabase<typeof wmsSchema>): Promise<string> {
  const id = randomUUID();

  // 보관주체 FK 는 이 스펙의 관심사가 아니다
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`
      INSERT INTO skus (id, code, name, package_width_mm, package_length_mm, package_height_mm, package_weight_g)
      VALUES (${id}, ${`T-${id.slice(0, 8)}`}, '테스트 상품', 120, 45, 30, 250)
    `);
  });

  return id;
}

export function actor(overrides: Partial<WorkshopActor> = {}): WorkshopActor {
  return { userId: randomUUID(), label: '작업자', canManage: false, canPublish: false, ...overrides };
}
