import { csCases, csLabels } from '../schema/customer-service.schema';

/**
 * Minimal in-memory fake of DbService<MergedSchema> for customer-service unit tests.
 * Filtering in where() supports the Drizzle eq()/and(eq()) predicates used by these tests
 * and falls back to loose matching for unknown predicates, matching the existing CS test style.
 * The most-recently inserted/updated row is tracked per table so update().returning()
 * can return a deterministic shape.
 */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

type Row = Record<string, any>;
type Condition = { key: string; value: unknown };

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isStringChunk(chunk: unknown): chunk is { value: string[] } {
  return Boolean(chunk && typeof chunk === 'object' && Array.isArray((chunk as { value?: unknown }).value));
}

function isColumnChunk(chunk: unknown): chunk is { name: string } {
  return Boolean(chunk && typeof chunk === 'object' && typeof (chunk as { name?: unknown }).name === 'string');
}

function isParamChunk(chunk: unknown): chunk is { value: unknown } {
  return Boolean(chunk && typeof chunk === 'object' && 'value' in chunk && !Array.isArray((chunk as { value?: unknown }).value));
}

function isSupportedSqlShape(chunks: unknown[]): boolean {
  return chunks.every((chunk) => {
    if ((chunk as { queryChunks?: unknown })?.queryChunks) return true;
    if (!isStringChunk(chunk)) return true;
    return chunk.value.every((part) => ['', '=', 'and', '(', ')'].includes(part.trim()));
  });
}

function collectEqConditions(predicate: unknown): Condition[] | null {
  const chunks = (predicate as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  if (!Array.isArray(chunks) || !isSupportedSqlShape(chunks)) return null;

  const conditions: Condition[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if ((chunk as { queryChunks?: unknown })?.queryChunks) {
      const nested = collectEqConditions(chunk);
      if (!nested) return null;
      conditions.push(...nested);
      continue;
    }

    const operatorChunk = chunks[index + 1];
    const paramChunk = chunks[index + 2];
    if (isColumnChunk(chunk) && isStringChunk(operatorChunk) && isParamChunk(paramChunk)) {
      const operator = operatorChunk.value.join('').trim();
      if (operator !== '=') return null;
      conditions.push({ key: snakeToCamel(chunk.name), value: paramChunk.value });
      index += 2;
    }
  }

  return conditions.length ? conditions : null;
}

function filterRows(rows: Row[], predicate: unknown): Row[] {
  const conditions = collectEqConditions(predicate);
  if (!conditions) return rows;
  return rows.filter((row) => conditions.every((condition) => row[condition.key] === condition.value));
}

function targetKeys(target: unknown): string[] {
  const columns = Array.isArray(target) ? target : [target];
  return columns.flatMap((column) => (isColumnChunk(column) ? [snakeToCamel(column.name)] : []));
}

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
        const makeSelectResult = (rows: Row[]) => {
          const r = [...rows] as Row[] & { orderBy: () => any; limit: (n: number) => Promise<Row[]> };
          Object.defineProperties(r, {
            orderBy: { value: () => ({ limit: (n: number) => Promise.resolve(rows.slice(0, n)) }) },
            limit: { value: (n: number) => Promise.resolve(rows.slice(0, n)) },
          });
          return r;
        };

        const chain: any = {
          where: (predicate: unknown) => makeSelectResult(filterRows(state.get(table), predicate)),
          innerJoin: () => chain,
          leftJoin: () => chain,
          orderBy: () => ({ limit: (n: number) => Promise.resolve(state.get(table).slice(0, n)) }),
          limit: (n: number) => Promise.resolve(state.get(table).slice(0, n)),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row | Row[]) => {
        const rowsBeforeInsert = [...state.get(table)];
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
          onConflictDoNothing: (options?: { target?: unknown }) => {
            if (!options?.target) {
              removeInsertedRows();
              return { returning: () => Promise.resolve([]) };
            }

            const keys = targetKeys(options.target);
            const kept = inserted.filter((row) => {
              const conflicts = keys.length
                ? rowsBeforeInsert.some((existing) => keys.every((key) => existing[key] === row[key]))
                : true;
              return !conflicts;
            });
            const rows = state.get(table);
            for (const row of inserted) {
              if (kept.includes(row)) continue;
              const index = rows.indexOf(row);
              if (index !== -1) rows.splice(index, 1);
            }
            return { returning: () => Promise.resolve(kept) };
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
      where: (predicate: unknown) => {
        const rows = state.get(table);
        const removed = filterRows(rows, predicate);
        state.rows.set(
          table,
          rows.filter((row) => !removed.includes(row)),
        );
        return { returning: () => Promise.resolve(removed) };
      },
    }),
  };

  const db = { db: { ...tx, transaction: (fn: (t: any) => any) => fn(tx) } };
  return { db, state, tx };
}
