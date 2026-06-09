import { BadRequestException } from '@nestjs/common';
import {
  productMasterPurchaseConstraints,
  productMasterVersions,
  productPurchaseConstraints,
} from '../../../schema/catalog.schema';
import { ProductPurchaseConstraintsService } from './product-purchase-constraints.service';

describe('ProductPurchaseConstraintsService decision helpers', () => {
  function makeService() {
    return new ProductPurchaseConstraintsService({ db: {} } as any);
  }

  it('treats disabled membership and null lifetime limit as delete intent', () => {
    const service = makeService() as any;

    expect(
      service.isDeleteIntent({
        requiresMembership: false,
        lifetimeQuantityLimit: null,
      }),
    ).toBe(true);
  });

  it('does not treat requiresMembership=true as delete intent', () => {
    const service = makeService() as any;

    expect(
      service.isDeleteIntent({
        requiresMembership: true,
        lifetimeQuantityLimit: null,
      }),
    ).toBe(false);
  });

  it('does not treat a positive lifetime limit as delete intent', () => {
    const service = makeService() as any;

    expect(
      service.isDeleteIntent({
        requiresMembership: false,
        lifetimeQuantityLimit: 3,
      }),
    ).toBe(false);
  });

  it('rejects zero lifetimeQuantityLimit before writing', () => {
    const service = makeService() as any;

    expect(() =>
      service.assertValidInput({
        requiresMembership: false,
        lifetimeQuantityLimit: 0,
      }),
    ).toThrow(BadRequestException);
  });
});

describe('ProductPurchaseConstraintsService copyMapping', () => {
  function makeService() {
    return new ProductPurchaseConstraintsService({ db: {} } as any);
  }

  function makeTx(selectResults: any[][]) {
    const inserts: any[] = [];

    return {
      inserts,
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => selectResults.shift() ?? []),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(async (value: any) => {
          inserts.push(value);
        }),
      })),
    };
  }

  it('rejects a target version that does not belong to the master before inserting', async () => {
    const service = makeService();
    const tx = makeTx([
      [{ id: 'from-version-id', masterId: 'master-id', status: 'active' }],
      [{ id: 'to-version-id', masterId: 'other-master-id', status: 'draft' }],
      [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'from-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    ]);

    await expect(service.copyMapping('master-id', 'from-version-id', 'to-version-id', tx as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.inserts).toHaveLength(0);
  });

  it('copies an existing mapping to the target version when both versions belong to the master', async () => {
    const service = makeService();
    const tx = makeTx([
      [{ id: 'from-version-id', masterId: 'master-id', status: 'active' }],
      [{ id: 'to-version-id', masterId: 'master-id', status: 'draft' }],
      [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'from-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    ]);

    await service.copyMapping('master-id', 'from-version-id', 'to-version-id', tx as any);

    expect(tx.inserts).toEqual([
      expect.objectContaining({
        masterId: 'master-id',
        versionId: 'to-version-id',
        purchaseConstraintId: 'constraint-id',
      }),
    ]);
  });
});

describe('ProductPurchaseConstraintsService upsert/delete behavior', () => {
  type VersionRow = {
    id: string;
    masterId: string;
    status: string;
  };

  type ConstraintRow = {
    id: string;
    requiresMembership: boolean;
    lifetimeQuantityLimit: number | null;
    createdAt?: Date;
    updatedAt?: Date;
  };

  type MappingRow = {
    id: string;
    masterId: string;
    versionId: string;
    purchaseConstraintId: string;
    createdAt?: Date;
  };

  type FakeState = {
    versions: VersionRow[];
    constraints: ConstraintRow[];
    mappings: MappingRow[];
  };

  function makeService() {
    return new ProductPurchaseConstraintsService({ db: {} } as any);
  }

  function makeStatefulTx(initialState: Partial<FakeState>) {
    const state: FakeState = {
      versions: initialState.versions ?? [],
      constraints: initialState.constraints ?? [],
      mappings: initialState.mappings ?? [],
    };

    const rowsForTable = (table: unknown) => {
      if (table === productMasterVersions) return state.versions;
      if (table === productPurchaseConstraints) return state.constraints;
      if (table === productMasterPurchaseConstraints) return state.mappings;
      throw new Error('Unsupported table in fake tx');
    };

    const columnToRowKey: Record<string, string> = {
      id: 'id',
      master_id: 'masterId',
      version_id: 'versionId',
      purchase_constraint_id: 'purchaseConstraintId',
      requires_membership: 'requiresMembership',
      lifetime_quantity_limit: 'lifetimeQuantityLimit',
      status: 'status',
    };

    const isColumnChunk = (chunk: any) => chunk && typeof chunk.name === 'string' && chunk.table;
    const isParamChunk = (chunk: any) =>
      chunk &&
      Object.prototype.hasOwnProperty.call(chunk, 'value') &&
      Object.prototype.hasOwnProperty.call(chunk, 'encoder');
    const chunkText = (chunk: any) => (Array.isArray(chunk?.value) ? chunk.value.join('') : '');

    const collectPredicates = (condition: any): Array<{ column: string; operator: 'eq' | 'ne'; value: unknown }> => {
      const chunks = condition?.queryChunks;
      if (!Array.isArray(chunks)) {
        return [];
      }

      const column = chunks.find(isColumnChunk);
      const param = chunks.find(isParamChunk);
      if (column && param) {
        const text = chunks.map(chunkText).join('');
        return [{ column: column.name, operator: text.includes('<>') ? 'ne' : 'eq', value: param.value }];
      }

      return chunks.flatMap((chunk) => collectPredicates(chunk));
    };

    const matchesWhere = (row: Record<string, unknown>, condition: any) => {
      const predicates = collectPredicates(condition);

      return predicates.every((predicate) => {
        const key = columnToRowKey[predicate.column] ?? predicate.column;
        return predicate.operator === 'ne' ? row[key] !== predicate.value : row[key] === predicate.value;
      });
    };

    const projectRows = <T extends Record<string, unknown>>(rows: T[], selection: Record<string, unknown>) => {
      if ('value' in selection) {
        return [{ value: rows.length }];
      }

      return rows.map((row) =>
        Object.keys(selection).reduce<Record<string, unknown>>((projected, key) => {
          projected[key] = row[key];
          return projected;
        }, {}),
      );
    };

    const withLimit = (rows: Array<Record<string, unknown>>) => {
      const result = rows as Array<Record<string, unknown>> & {
        limit: (limit: number) => Promise<Record<string, unknown>[]>;
      };
      result.limit = async (limit: number) => rows.slice(0, limit);
      return result;
    };

    return {
      state,
      select: jest.fn((selection: Record<string, unknown>) => ({
        from: jest.fn((table: unknown) => ({
          where: jest.fn((condition: unknown) =>
            withLimit(
              projectRows(
                rowsForTable(table).filter((row) => matchesWhere(row, condition)),
                selection,
              ),
            ),
          ),
        })),
      })),
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((value: Record<string, unknown>) => {
          rowsForTable(table).push(value as never);
          return {
            returning: jest.fn(async (selection: Record<string, unknown>) => projectRows([value], selection)),
          };
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: jest.fn((updates: Record<string, unknown>) => ({
          where: jest.fn((condition: unknown) => {
            const matchedRows = rowsForTable(table).filter((row) => matchesWhere(row, condition));
            matchedRows.forEach((row) => Object.assign(row, updates));
            return {
              returning: jest.fn(async (selection: Record<string, unknown>) => projectRows(matchedRows, selection)),
            };
          }),
        })),
      })),
      delete: jest.fn((table: unknown) => ({
        where: jest.fn((condition: unknown) => {
          const rows = rowsForTable(table);
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (matchesWhere(rows[index], condition)) {
              rows.splice(index, 1);
            }
          }
        }),
      })),
    };
  }

  it('creates a new constraint row and mapping when the draft version has no mapping', async () => {
    const service = makeService();
    const tx = makeStatefulTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
    });

    const result = await service.upsertForDraft(
      'master-id',
      'draft-version-id',
      {
        requiresMembership: true,
        lifetimeQuantityLimit: 5,
      },
      tx as any,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        requiresMembership: true,
        lifetimeQuantityLimit: 5,
      }),
    );
    expect(tx.state.constraints).toEqual([
      expect.objectContaining({
        id: result?.id,
        requiresMembership: true,
        lifetimeQuantityLimit: 5,
      }),
    ]);
    expect(tx.state.mappings).toEqual([
      expect.objectContaining({
        masterId: 'master-id',
        versionId: 'draft-version-id',
        purchaseConstraintId: result?.id,
      }),
    ]);
  });

  it('updates an unshared existing constraint row in place', async () => {
    const service = makeService();
    const tx = makeStatefulTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      constraints: [{ id: 'constraint-id', requiresMembership: false, lifetimeQuantityLimit: null }],
      mappings: [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    });

    const result = await service.upsertForDraft(
      'master-id',
      'draft-version-id',
      {
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      },
      tx as any,
    );

    expect(result).toEqual({
      id: 'constraint-id',
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
    expect(tx.state.constraints).toEqual([
      expect.objectContaining({
        id: 'constraint-id',
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      }),
    ]);
    expect(tx.state.mappings).toEqual([
      expect.objectContaining({
        id: 'mapping-id',
        purchaseConstraintId: 'constraint-id',
      }),
    ]);
  });

  it('performs copy-on-write for a shared constraint row', async () => {
    const service = makeService();
    const tx = makeStatefulTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      constraints: [{ id: 'shared-constraint-id', requiresMembership: false, lifetimeQuantityLimit: null }],
      mappings: [
        {
          id: 'current-mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'shared-constraint-id',
        },
        {
          id: 'other-mapping-id',
          masterId: 'master-id',
          versionId: 'other-version-id',
          purchaseConstraintId: 'shared-constraint-id',
        },
      ],
    });

    const result = await service.upsertForDraft(
      'master-id',
      'draft-version-id',
      {
        requiresMembership: true,
        lifetimeQuantityLimit: 7,
      },
      tx as any,
    );

    expect(result?.id).not.toBe('shared-constraint-id');
    expect(tx.state.constraints).toEqual([
      expect.objectContaining({
        id: 'shared-constraint-id',
        requiresMembership: false,
        lifetimeQuantityLimit: null,
      }),
      expect.objectContaining({
        id: result?.id,
        requiresMembership: true,
        lifetimeQuantityLimit: 7,
      }),
    ]);
    expect(tx.state.mappings).toEqual([
      expect.objectContaining({
        id: 'current-mapping-id',
        purchaseConstraintId: result?.id,
      }),
      expect.objectContaining({
        id: 'other-mapping-id',
        purchaseConstraintId: 'shared-constraint-id',
      }),
    ]);
  });

  it('uses delete intent to remove the mapping and delete an orphaned constraint row', async () => {
    const service = makeService();
    const tx = makeStatefulTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      constraints: [{ id: 'constraint-id', requiresMembership: true, lifetimeQuantityLimit: 2 }],
      mappings: [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    });

    const result = await service.upsertForDraft(
      'master-id',
      'draft-version-id',
      {
        requiresMembership: false,
        lifetimeQuantityLimit: null,
      },
      tx as any,
    );

    expect(result).toBeNull();
    expect(tx.state.mappings).toEqual([]);
    expect(tx.state.constraints).toEqual([]);
  });

  it('deleteForDraft removes only the mapping and keeps a shared constraint row', async () => {
    const service = makeService();
    const tx = makeStatefulTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      constraints: [{ id: 'shared-constraint-id', requiresMembership: true, lifetimeQuantityLimit: 2 }],
      mappings: [
        {
          id: 'current-mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'shared-constraint-id',
        },
        {
          id: 'other-mapping-id',
          masterId: 'master-id',
          versionId: 'other-version-id',
          purchaseConstraintId: 'shared-constraint-id',
        },
      ],
    });

    await service.deleteForDraft('master-id', 'draft-version-id', tx as any);

    expect(tx.state.mappings).toEqual([
      expect.objectContaining({
        id: 'other-mapping-id',
        purchaseConstraintId: 'shared-constraint-id',
      }),
    ]);
    expect(tx.state.constraints).toEqual([
      expect.objectContaining({
        id: 'shared-constraint-id',
      }),
    ]);
  });
});
