import { csCases } from '../schema/customer-service.schema';
import { makeFakeDb } from './fake-db';

describe('makeFakeDb', () => {
  it('inserts rows and reads them back', async () => {
    const { db, state } = makeFakeDb();
    const [row] = await db.db
      .insert(csCases)
      .values({ subject: 'hello' } as Record<string, unknown>)
      .returning();
    expect(row.subject).toBe('hello');
    expect(state.get(csCases)).toHaveLength(1);
  });

  it('updates rows via set().where().returning()', async () => {
    const { db } = makeFakeDb();
    const [row] = await db.db
      .insert(csCases)
      .values({ subject: 'a' } as Record<string, unknown>)
      .returning();
    const [updated] = await db.db
      .update(csCases)
      .set({ subject: 'b' })
      .where({ id: row.id } as unknown as never)
      .returning();
    expect(updated.subject).toBe('b');
  });
});
