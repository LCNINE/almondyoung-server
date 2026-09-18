import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { DbService } from '@app/db';
import { pimSchema, productAuditLog } from '../../schema/catalog.schema';
import { ProductAuditService } from './product-audit.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('감사 로그 목록 페이지네이션 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('같은 timestamp 로 남은 기록도 페이지 사이에 겹치거나 빠지지 않는다', async () => {
    const action = `tie-${randomUUID().slice(0, 8)}`;
    const timestamp = new Date();

    await drizzle(sql, { schema: pimSchema })
      .transaction(async (tx) => {
        const rows = Array.from({ length: 45 }, () => ({
          id: randomUUID(),
          action,
          userId: randomUUID(),
          timestamp,
        }));
        await tx.insert(productAuditLog).values(rows);

        const service = new ProductAuditService({ db: tx } as unknown as DbService<typeof pimSchema>);
        const seen: string[] = [];
        for (let page = 1; page <= 5; page += 1) {
          const result = await service.listAuditLogs({ action, page, limit: 10 });
          expect(result.total).toBe(45);
          seen.push(...result.data.map((r) => r.id));
        }

        expect(seen).toHaveLength(45);
        expect(new Set(seen)).toEqual(new Set(rows.map((r) => r.id)));
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
