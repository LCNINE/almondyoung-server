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

  it('persists rows when insert values is awaited without returning', async () => {
    const { db, state } = makeFakeDb();
    await db.db.insert(csCases).values({ subject: 'bare' } as Record<string, unknown>);
    expect(state.get(csCases)).toHaveLength(1);
    expect(state.get(csCases)[0].subject).toBe('bare');
  });

  it('applies csCases defaults and reads through the select chain', async () => {
    const { db } = makeFakeDb();
    await db.db.insert(csCases).values({ subject: 'defaults' } as Record<string, unknown>);
    const [row] = await db.db
      .select()
      .from(csCases)
      .where({ subject: 'defaults' } as unknown as never)
      .limit(1);
    expect(row).toMatchObject({
      subject: 'defaults',
      status: 'open',
      priority: 'normal',
      sourceChannel: 'kakao',
      metadata: {},
      description: null,
      externalThreadRef: null,
      customerId: null,
      customerName: null,
      assignedTo: null,
      createdBy: null,
      closedAt: null,
    });
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
