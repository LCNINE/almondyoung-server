import {
  productMasterPurchaseConstraints,
  productPurchaseConstraints,
} from '../../schema/catalog.schema';
import { deleteEntitiesIfUnmapped } from './delete-if-unmapped';

describe('deleteEntitiesIfUnmapped', () => {
  const spec = {
    entityTable: productPurchaseConstraints,
    entityIdColumn: productPurchaseConstraints.id,
    junctionTable: productMasterPurchaseConstraints,
    junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
  };

  // Extract the bound id from an `eq(column, id)` Drizzle condition.
  function idFromCondition(condition: any): string | undefined {
    const findParam = (chunk: any): any => {
      if (
        chunk &&
        Object.prototype.hasOwnProperty.call(chunk, 'value') &&
        Object.prototype.hasOwnProperty.call(chunk, 'encoder')
      ) {
        return chunk;
      }
      const chunks = chunk?.queryChunks;
      if (Array.isArray(chunks)) {
        for (const c of chunks) {
          const found = findParam(c);
          if (found) return found;
        }
      }
      return undefined;
    };
    return findParam(condition)?.value;
  }

  function makeTx(mappingCounts: Record<string, number>) {
    const deletedIds: string[] = [];
    const tx: any = {
      select: () => ({
        from: () => ({
          where: (condition: any) => {
            const id = idFromCondition(condition) ?? '';
            const n = mappingCounts[id] ?? 0;
            return Array.from({ length: n }, () => ({ ref: id }));
          },
        }),
      }),
      delete: () => ({
        where: (condition: any) => {
          deletedIds.push(idFromCondition(condition) ?? '');
          return Promise.resolve();
        },
      }),
    };
    return { tx, deletedIds };
  }

  it('deletes an entity with zero remaining junction mappings', async () => {
    const { tx, deletedIds } = makeTx({ orphan: 0 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['orphan']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['orphan']);
  });

  it('keeps an entity still referenced by another version', async () => {
    const { tx, deletedIds } = makeTx({ shared: 2 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['shared']);
    expect(count).toBe(0);
    expect(deletedIds).toEqual([]);
  });

  it('deletes only the orphans in a mixed batch', async () => {
    const { tx, deletedIds } = makeTx({ a: 0, b: 1 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['a', 'b']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['a']);
  });

  it('dedupes candidate ids so an orphan is checked and deleted once', async () => {
    const { tx, deletedIds } = makeTx({ x: 0 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['x', 'x']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['x']);
  });

  it('does nothing for an empty candidate list', async () => {
    const { tx, deletedIds } = makeTx({});
    const count = await deleteEntitiesIfUnmapped(tx, spec, []);
    expect(count).toBe(0);
    expect(deletedIds).toEqual([]);
  });
});
