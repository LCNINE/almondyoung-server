import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { DbTx, sku3dWorkshopJobs, sku3dWorkshopRevisions, wmsSchema } from '../../schema/inventory.schema';
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

// 워커 없이 완성 버전 하나를 만든다 — 작업실의 첫 작업을 끝난 것으로 돌린다
export async function finishedRevision(
  db: PostgresJsDatabase<typeof wmsSchema>,
  workshopId: string,
  glbSha256 = 'a'.repeat(64),
): Promise<string> {
  const [job] = await db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.workshopId, workshopId));

  await db.update(sku3dWorkshopJobs).set({ status: 'succeeded' }).where(eq(sku3dWorkshopJobs.id, job.id));

  const [revision] = await db
    .insert(sku3dWorkshopRevisions)
    .values({
      workshopId,
      jobId: job.id,
      number: 1,
      glbFileId: randomUUID(),
      glbSha256,
      glbBytes: 100,
      files: { renders: [], python: null, blend: null, plan: null },
      review: {
        summary: 's',
        verdict: 'ready_for_review',
        issues: [],
        proposals: [],
        autoFixes: [],
        unseenFaces: [],
        assumptions: [],
        needsPhotos: [],
        dimensionsUsed: { widthMm: 1, lengthMm: 1, heightMm: 1, basis: 'package' },
      },
      provenance: {},
    })
    .returning();

  return revision.id;
}
