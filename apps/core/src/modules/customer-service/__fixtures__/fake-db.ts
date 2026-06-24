import { csCases, csLabels } from '../schema/customer-service.schema';

/**
 * Minimal in-memory fake of DbService<MergedSchema> for customer-service unit tests.
 * Filtering in where() is intentionally loose (returns all rows for the table); tests
 * assert on inserted/updated state and returned objects, matching the existing CS test style.
 * The most-recently inserted/updated row is tracked per table so update().returning()
 * can return a deterministic shape.
 */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

type Row = Record<string, any>;

export function makeFakeDb(seed: Map<unknown, Row[]> = new Map()) {
  const state = {
    rows: seed,
    get(table: unknown): Row[] {
      if (!this.rows.has(table)) this.rows.set(table, []);
      return this.rows.get(table)!;
    },
  };

  const makeRow = (table: unknown, values: Row): Row => ({
    ...(table === csCases
      ? {
          status: 'open',
          priority: 'normal',
          description: null,
          sourceChannel: 'kakao',
          externalThreadRef: null,
          customerId: null,
          customerName: null,
          assignedTo: null,
          metadata: {},
          createdBy: null,
          closedAt: null,
        }
      : {}),
    ...(table === csLabels
      ? {
          color: '#888888',
          isActive: true,
          sortOrder: 0,
        }
      : {}),
    ...values,
    id: values.id ?? nextId(),
    createdAt: values.createdAt ?? new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: values.updatedAt ?? new Date('2026-06-20T00:00:00.000Z'),
  });

  const insertRows = (table: unknown, values: Row | Row[]): Row[] => {
    const list = Array.isArray(values) ? values : [values];
    return list.map((v) => {
      const row = makeRow(table, v);
      state.get(table).push(row);
      return row;
    });
  };

  const tx: any = {
    select: (_columns?: unknown) => ({
      from: (table: unknown) => {
        const all = state.get(table);
        const chain: any = {
          where: () => {
            const r = [...all] as Row[] & { orderBy: () => any; limit: (n: number) => Promise<Row[]> };
            r.orderBy = () => ({ limit: (n: number) => Promise.resolve(all.slice(0, n)) });
            (r as any).limit = (n: number) => Promise.resolve(all.slice(0, n));
            return r;
          },
          innerJoin: () => chain,
          leftJoin: () => chain,
          orderBy: () => ({ limit: (n: number) => Promise.resolve(all.slice(0, n)) }),
          limit: (n: number) => Promise.resolve(all.slice(0, n)),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row | Row[]) => {
        const inserted = insertRows(table, values);
        const removeInsertedRows = () => {
          const rows = state.get(table);
          for (const row of inserted) {
            const index = rows.indexOf(row);
            if (index !== -1) rows.splice(index, 1);
          }
        };

        return {
          returning: () => Promise.resolve(inserted),
          onConflictDoNothing: () => {
            removeInsertedRows();
            return { returning: () => Promise.resolve([]) };
          },
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: () => ({
          returning: () => {
            const rows = state.get(table);
            const target = rows[rows.length - 1];
            if (!target) return Promise.resolve([]);
            Object.assign(target, patch, { updatedAt: new Date('2026-06-20T00:01:00.000Z') });
            return Promise.resolve([target]);
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        state.rows.set(table, []);
        return Promise.resolve([]);
      },
    }),
  };

  const db = { db: { ...tx, transaction: (fn: (t: any) => any) => fn(tx) } };
  return { db, state, tx };
}
