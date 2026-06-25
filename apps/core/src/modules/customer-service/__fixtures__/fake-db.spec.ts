/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { and, eq } from 'drizzle-orm';
import { csCaseLabels, csCases } from '../schema/customer-service.schema';
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

  it('does not persist rows when onConflictDoNothing returns no rows', async () => {
    const { db, state } = makeFakeDb();
    const result = await db.db
      .insert(csCases)
      .values({ subject: 'skip' } as Record<string, unknown>)
      .onConflictDoNothing()
      .returning();
    expect(result).toEqual([]);
    expect(state.get(csCases)).toHaveLength(0);
  });

  it('persists transaction inserts through the same state', async () => {
    const { db, state } = makeFakeDb();
    const [row] = await db.db.transaction((tx) =>
      tx
        .insert(csCases)
        .values({ subject: 'tx' } as Record<string, unknown>)
        .returning(),
    );
    expect(row.subject).toBe('tx');
    expect(state.get(csCases)).toHaveLength(1);
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

  it('updates only rows matching eq predicates', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCases, [
      { id: 'case-1', subject: 'a' },
      { id: 'case-2', subject: 'b' },
    ]);
    const { db, state } = makeFakeDb(seed);

    const updated = await db.db.update(csCases).set({ subject: 'updated' }).where(eq(csCases.id, 'case-1')).returning();

    expect(updated).toEqual([expect.objectContaining({ id: 'case-1', subject: 'updated' })]);
    expect(state.get(csCases)).toEqual([
      expect.objectContaining({ id: 'case-1', subject: 'updated' }),
      expect.objectContaining({ id: 'case-2', subject: 'b' }),
    ]);
  });

  it('filters select rows with eq predicates', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCaseLabels, [
      { id: 'cl1', csCaseId: 'case-1', labelId: 'label-1' },
      { id: 'cl2', csCaseId: 'case-2', labelId: 'label-1' },
    ]);
    const { db } = makeFakeDb(seed);

    const rows = await db.db.select().from(csCaseLabels).where(eq(csCaseLabels.csCaseId, 'case-1'));

    expect(rows).toEqual([expect.objectContaining({ id: 'cl1' })]);
  });

  it('deletes and returns only rows matching and(eq, eq) predicates', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCaseLabels, [
      { id: 'cl1', csCaseId: 'case-1', labelId: 'label-1' },
      { id: 'cl2', csCaseId: 'case-2', labelId: 'label-1' },
      { id: 'cl3', csCaseId: 'case-1', labelId: 'label-2' },
    ]);
    const { db, state } = makeFakeDb(seed);

    const removed = await db.db
      .delete(csCaseLabels)
      .where(and(eq(csCaseLabels.csCaseId, 'case-1'), eq(csCaseLabels.labelId, 'label-1')))
      .returning();

    expect(removed).toEqual([expect.objectContaining({ id: 'cl1' })]);
    expect(state.get(csCaseLabels)).toEqual([
      expect.objectContaining({ id: 'cl2' }),
      expect.objectContaining({ id: 'cl3' }),
    ]);
  });

  it('keeps non-conflicting rows when onConflictDoNothing receives a target', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCaseLabels, [{ id: 'cl1', csCaseId: 'case-1', labelId: 'label-1' }]);
    const { db, state } = makeFakeDb(seed);

    const inserted = await db.db
      .insert(csCaseLabels)
      .values([
        { id: 'cl2', csCaseId: 'case-1', labelId: 'label-1' },
        { id: 'cl3', csCaseId: 'case-2', labelId: 'label-1' },
      ])
      .onConflictDoNothing({ target: [csCaseLabels.csCaseId, csCaseLabels.labelId] })
      .returning();

    expect(inserted).toEqual([expect.objectContaining({ id: 'cl3' })]);
    expect(state.get(csCaseLabels)).toEqual([
      expect.objectContaining({ id: 'cl1' }),
      expect.objectContaining({ id: 'cl3' }),
    ]);
  });
});
