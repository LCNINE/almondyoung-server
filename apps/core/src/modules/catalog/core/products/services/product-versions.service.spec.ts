jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductVersionsService } from './product-versions.service';
import type { DbTransaction } from '../../../catalog.types';
import {
  productMasterOptionGroups,
  productMasterPricingRules,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productPurchaseConstraints,
  productTagValues,
} from '../../../schema/catalog.schema';

describe('ProductVersionsService Medusa projection outbox events', () => {
  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };
    const projectionSnapshotAssembler = {
      assembleActiveVersionSnapshot: jest.fn(),
    };
    const pricingValidator = {
      validateCalculatedPrices: jest.fn().mockResolvedValue(undefined),
    };
    const priceCacheService = {
      cachePricesForVersion: jest.fn().mockResolvedValue(undefined),
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariants: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ProductVersionsService(
      {} as any,
      productPublisher as any,
      outboxPublisher as any,
      pricingValidator as any,
      {} as any,
      projectionSnapshotAssembler as any,
      priceCacheService as any,
      {} as any,
      productSellableQuantity as any,
    );

    return {
      service,
      productPublisher,
      outboxPublisher,
      projectionSnapshotAssembler,
      pricingValidator,
      priceCacheService,
      productSellableQuantity,
    };
  }

  it('enqueues ProductMasterActiveVersionChanged through the transactional outbox using the provided tx', async () => {
    const { service, productPublisher, outboxPublisher, projectionSnapshotAssembler } = makeService();
    const tx = {} as any;
    const snapshot = {
      masterId: 'master-1',
      versionId: 'version-2',
      version: 2,
      name: 'Lip Tint',
      variants: [],
      status: 'active',
      isWholesaleOnly: false,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isMembershipOnly: false,
      isGiftcard: false,
      discountable: true,
      categories: [{ id: 'cat-1' }],
      purchaseConstraint: {
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      },
    };

    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockResolvedValue({
      snapshot,
      categoryIds: ['cat-1'],
      primaryCategoryId: 'cat-1',
    });

    await (service as any)._emitActiveVersionChangedEvent(
      {
        id: 'version-2',
        masterId: 'master-1',
        name: 'Lip Tint',
      },
      null,
      'published',
      tx,
    );

    expect(projectionSnapshotAssembler.assembleActiveVersionSnapshot).toHaveBeenCalledWith('master-1', 'version-2', tx);
    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateType: 'Product',
        aggregateId: 'master-1',
        payload: expect.objectContaining({
          masterId: 'master-1',
          versionId: 'version-2',
          name: 'Lip Tint',
          previousActiveVersionId: null,
          categoryIds: ['cat-1'],
          primaryCategoryId: 'cat-1',
          changeReason: 'published',
          snapshot: expect.objectContaining({
            purchaseConstraint: {
              requiresMembership: true,
              lifetimeQuantityLimit: 3,
            },
          }),
        }),
      }),
      tx,
    );
    expect(productPublisher.publishEvent).not.toHaveBeenCalled();
  });

  it('uses the caller-provided active changeReason instead of inferring rollback from previous active version', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    const tx = {} as any;
    const snapshot = {
      masterId: 'master-1',
      versionId: 'version-2',
      version: 2,
      name: 'Snapshot Name',
      variants: [],
      status: 'active',
      isWholesaleOnly: false,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isMembershipOnly: false,
      isGiftcard: false,
      discountable: true,
      categories: [],
    };
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockResolvedValue({
      snapshot,
      categoryIds: [],
      primaryCategoryId: null,
    });

    await (service as any)._emitActiveVersionChangedEvent(
      {
        id: 'version-2',
        masterId: 'master-1',
        name: 'Version Name',
      },
      {
        id: 'version-1',
        masterId: 'master-1',
      },
      'published',
      tx,
    );

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          versionId: 'version-2',
          name: 'Snapshot Name',
          previousActiveVersionId: 'version-1',
          changeReason: 'published',
          snapshot,
        }),
      }),
      tx,
    );
  });

  it('fails published/rollback events before enqueueing when the projection snapshot cannot be assembled', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    const tx = {} as any;
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockRejectedValue(new Error('snapshot unavailable'));

    await expect(
      (service as any)._emitActiveVersionChangedEvent(
        {
          id: 'version-2',
          masterId: 'master-1',
          name: 'Lip Tint',
        },
        null,
        'published',
        tx,
      ),
    ).rejects.toThrow('snapshot unavailable');

    expect(outboxPublisher.saveEvent).not.toHaveBeenCalled();
  });

  it('enqueues unpublished events without a snapshot, active version id, or category projection', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    const tx = {} as any;

    await (service as any)._emitActiveVersionChangedEvent(
      {
        id: 'version-2',
        masterId: 'master-1',
        name: 'Lip Tint',
      },
      {
        id: 'version-2',
        masterId: 'master-1',
      },
      'unpublished',
      tx,
    );

    expect(projectionSnapshotAssembler.assembleActiveVersionSnapshot).not.toHaveBeenCalled();
    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          masterId: 'master-1',
          versionId: null,
          name: null,
          previousActiveVersionId: 'version-2',
          categoryIds: [],
          primaryCategoryId: null,
          changeReason: 'unpublished',
          snapshot: null,
        }),
      }),
      tx,
    );
  });

  it('publishes a draft with validation, price cache, active transition, snapshot enqueue, and sellable recalculation in order', async () => {
    const {
      service,
      outboxPublisher,
      projectionSnapshotAssembler,
      pricingValidator,
      priceCacheService,
      productSellableQuantity,
    } = makeService();
    const order: string[] = [];
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn((values: { status?: string }) => ({
          where: jest.fn(async () => {
            if (values.status === 'inactive') {
              order.push('deactivatePrevious');
            }
            if (values.status === 'active') {
              order.push('activateTarget');
            }
          }),
        })),
      })),
    };

    (service as any).getVersionById = jest.fn().mockResolvedValue({
      id: 'version-2',
      masterId: 'master-1',
      status: 'draft',
      name: 'Lip Tint',
      fulfillmentKind: 'physical',
    });
    (service as any).getActiveVersion = jest.fn().mockResolvedValue({
      id: 'version-1',
      masterId: 'master-1',
      status: 'active',
    });
    (service as any)._validateVariantCodeUniqueness = jest.fn(async () => order.push('validateVariantCode'));
    service.validateProductCodeUniqueness = jest.fn(async () => order.push('validateProductCode')) as any;
    pricingValidator.validateCalculatedPrices.mockImplementation(async () => order.push('validatePrices'));
    priceCacheService.cachePricesForVersion.mockImplementation(async () => order.push('cachePrices'));
    (service as any)._reconcileMatchingsAfterPublish = jest.fn(async () => order.push('reconcileMatchings'));
    (service as any)._reconcileAssetLinksAfterPublish = jest.fn(async () => order.push('reconcileAssetLinks'));
    (service as any)._publishVariantChangeEvents = jest.fn(async () => order.push('publishVariantChanges'));
    (service as any).getVersionVariants = jest.fn().mockResolvedValue([]);
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockImplementation(async () => {
      order.push('assembleSnapshot');
      return {
        snapshot: {
          masterId: 'master-1',
          versionId: 'version-2',
          version: 2,
          name: 'Lip Tint',
          variants: [],
          status: 'active',
          isWholesaleOnly: false,
          hideMembershipPriceForNonMembers: false,
          isVisibleToMembersOnly: false,
          isMembershipOnly: false,
          isGiftcard: false,
          discountable: true,
          categories: [],
        },
        categoryIds: [],
        primaryCategoryId: null,
      };
    });
    outboxPublisher.saveEvent.mockImplementation(async () => order.push('saveOutbox'));
    productSellableQuantity.recalculateAndPublishForVariants.mockImplementation(async () =>
      order.push('recalculateSellableQuantity'),
    );

    await service.publishVersion('version-2', tx as any);

    expect(order).toEqual([
      'validateVariantCode',
      'validateProductCode',
      'validatePrices',
      'cachePrices',
      'deactivatePrevious',
      'activateTarget',
      'reconcileMatchings',
      'reconcileAssetLinks',
      'publishVariantChanges',
      'assembleSnapshot',
      'saveOutbox',
      'recalculateSellableQuantity',
    ]);
    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          changeReason: 'published',
          previousActiveVersionId: 'version-1',
        }),
      }),
      tx,
    );
  });

  it('determines publish changeReason from the target version pre-publish status', async () => {
    const { service } = makeService();
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    const emit = jest.fn().mockResolvedValue(undefined);

    (service as any)._emitActiveVersionChangedEvent = emit;
    (service as any)._validateVariantCodeUniqueness = jest.fn().mockResolvedValue(undefined);
    service.validateProductCodeUniqueness = jest.fn().mockResolvedValue(undefined) as any;
    (service as any)._reconcileMatchingsAfterPublish = jest.fn().mockResolvedValue(undefined);
    (service as any)._reconcileAssetLinksAfterPublish = jest.fn().mockResolvedValue(undefined);
    (service as any)._validateDigitalAssetLinks = jest.fn().mockResolvedValue(undefined);
    (service as any)._publishVariantChangeEvents = jest.fn().mockResolvedValue(undefined);
    (service as any).getVersionVariants = jest.fn().mockResolvedValue([]);

    const draftVersion = {
      id: 'version-draft',
      masterId: 'master-1',
      status: 'draft',
      name: 'Draft',
    };
    const inactiveVersion = {
      id: 'version-inactive',
      masterId: 'master-1',
      status: 'inactive',
      name: 'Inactive',
    };
    const previousActiveVersion = {
      id: 'version-active',
      masterId: 'master-1',
      status: 'active',
    };

    (service as any).getActiveVersion = jest.fn().mockResolvedValue(previousActiveVersion);
    (service as any).getVersionById = jest
      .fn()
      .mockResolvedValueOnce(draftVersion)
      .mockResolvedValueOnce(inactiveVersion);

    await service.publishVersion('version-draft', tx as any);
    await service.publishVersion('version-inactive', tx as any);

    expect(emit).toHaveBeenNthCalledWith(1, draftVersion, previousActiveVersion, 'published', tx);
    expect(emit).toHaveBeenNthCalledWith(2, inactiveVersion, previousActiveVersion, 'rollback', tx);
  });
});

describe('ProductVersionsService copy mappings', () => {
  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };

    return new ProductVersionsService(
      {} as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  function makeTx() {
    const inserts: Array<{ table: unknown; values: unknown }> = [];
    const purchaseConstraintMappings = [
      {
        id: 'mapping-1',
        masterId: 'master-1',
        versionId: 'version-1',
        purchaseConstraintId: 'constraint-1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ];

    const rowsForTable = (table: unknown) => {
      if (table === productMasterPurchaseConstraints) {
        return purchaseConstraintMappings;
      }

      return [];
    };

    const withOrderBy = <T>(rows: T[]) => {
      const result = rows as T[] & { orderBy: () => Promise<T[]> };
      result.orderBy = async () => rows;
      return result;
    };

    return {
      inserts,
      select: jest.fn(() => ({
        from: jest.fn((table: unknown) => {
          const chain = {
            innerJoin: jest.fn(() => chain),
            where: jest.fn(() => withOrderBy(rowsForTable(table))),
          };

          return chain;
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: jest.fn(async (values: unknown) => {
          inserts.push({ table, values });
        }),
      })),
    };
  }

  it('copies purchase constraint mappings from the source version to the draft target', async () => {
    const service = makeService();
    const tx = makeTx();

    await (service as any)._copyMappings(tx, 'master-1', 'version-1', 'version-2');

    expect(tx.inserts).toContainEqual({
      table: productMasterPurchaseConstraints,
      values: [
        expect.objectContaining({
          masterId: 'master-1',
          versionId: 'version-2',
          purchaseConstraintId: 'constraint-1',
          createdAt: expect.any(Date),
        }),
      ],
    });
  });
});

describe('ProductVersionsService productCode publish validation', () => {
  function makeService() {
    return new ProductVersionsService(
      {} as any,
      { publishEvent: jest.fn() } as any,
      { saveEvent: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  function makeTx(activeVersions: Array<{ masterId: string }>): DbTransaction {
    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(activeVersions),
        })),
      })),
    } as unknown as DbTransaction;
  }

  it('allows a draft to reuse the productCode of its own active version', async () => {
    const service = makeService();
    const tx = makeTx([{ masterId: 'master-1' }]);

    await expect(
      service.validateProductCodeUniqueness({ masterId: 'master-1', productCode: 'PROD-001' }, tx),
    ).resolves.toBeUndefined();
  });

  it('rejects a productCode used by another active master', async () => {
    const service = makeService();
    const tx = makeTx([{ masterId: 'master-2' }]);

    await expect(
      service.validateProductCodeUniqueness({ masterId: 'master-1', productCode: 'PROD-001' }, tx),
    ).rejects.toThrow('productCode PROD-001 is already used by another active product');
  });
});

describe('ProductVersionsService digital asset-link publish guard', () => {
  function makeService(variantAssetLinkService: any) {
    return new ProductVersionsService(
      {} as any,
      { publishEvent: jest.fn() } as any,
      { saveEvent: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      variantAssetLinkService,
      {} as any,
    );
  }

  const physicalVersion = { id: 'v1', masterId: 'm1', fulfillmentKind: 'physical' } as any;
  const digitalVersion = { id: 'v2', masterId: 'm2', fulfillmentKind: 'digital' } as any;

  it('물리 상품은 asset link 와 무관하게 publish 검증을 통과한다', async () => {
    const link = { listAssetsForVariant: jest.fn() };
    const service = makeService(link);

    await expect((service as any)._validateDigitalAssetLinks(physicalVersion, {} as any)).resolves.toBeUndefined();
    expect(link.listAssetsForVariant).not.toHaveBeenCalled();
  });

  it('디지털 상품의 모든 변종에 다운로드 가능한 자산(파일버전 보유)이 있으면 통과한다', async () => {
    const link = { listAssetsForVariant: jest.fn().mockResolvedValue([{ id: 'a1', currentFileVersionId: 'fv1' }]) };
    const service = makeService(link);
    (service as any).getVersionVariants = jest.fn().mockResolvedValue(['var1', 'var2']);

    await expect((service as any)._validateDigitalAssetLinks(digitalVersion, {} as any)).resolves.toBeUndefined();
  });

  it('디지털 상품에 asset link 없는 변종이 있으면 publish 를 차단한다', async () => {
    const link = {
      listAssetsForVariant: jest
        .fn()
        .mockImplementation((variantId: string) =>
          Promise.resolve(variantId === 'var1' ? [{ id: 'a1', currentFileVersionId: 'fv1' }] : []),
        ),
    };
    const service = makeService(link);
    (service as any).getVersionVariants = jest.fn().mockResolvedValue(['var1', 'var2']);

    await expect((service as any)._validateDigitalAssetLinks(digitalVersion, {} as any)).rejects.toThrow(
      'asset link 없는 변종',
    );
  });

  it('asset link 는 있으나 파일 버전이 없으면(다운로드 불가) publish 를 차단한다', async () => {
    const link = { listAssetsForVariant: jest.fn().mockResolvedValue([{ id: 'a1', currentFileVersionId: null }]) };
    const service = makeService(link);
    (service as any).getVersionVariants = jest.fn().mockResolvedValue(['var1']);

    await expect((service as any)._validateDigitalAssetLinks(digitalVersion, {} as any)).rejects.toThrow(
      '파일 버전이 없어 다운로드 불가',
    );
  });
});

describe('ProductVersionsService deleteDraftVersion purchase constraint cleanup', () => {
  type VersionRow = {
    id: string;
    masterId: string;
    status: string;
  };

  type PurchaseConstraintRow = {
    id: string;
    requiresMembership: boolean;
    lifetimeQuantityLimit: number | null;
  };

  type PurchaseConstraintMappingRow = {
    id: string;
    masterId: string;
    versionId: string;
    purchaseConstraintId: string;
  };

  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };

    return new ProductVersionsService(
      {} as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  function makeDeleteDraftTx(input: {
    versions: VersionRow[];
    purchaseConstraints: PurchaseConstraintRow[];
    purchaseConstraintMappings: PurchaseConstraintMappingRow[];
  }) {
    const state = {
      versions: [...input.versions],
      purchaseConstraints: [...input.purchaseConstraints],
      purchaseConstraintMappings: [...input.purchaseConstraintMappings],
      optionGroupDisplays: [],
      optionValueDisplays: [],
      optionGroupMappings: [],
      variantMappings: [],
      tagValueMappings: [],
      pricingRuleMappings: [],
    };

    const rowsForTable = (table: unknown) => {
      if (table === productMasterVersions) return state.versions;
      if (table === productPurchaseConstraints) return state.purchaseConstraints;
      if (table === productMasterPurchaseConstraints) return state.purchaseConstraintMappings;
      if (table === productOptionGroupDisplays) return state.optionGroupDisplays;
      if (table === productOptionValueDisplays) return state.optionValueDisplays;
      if (table === productMasterOptionGroups) return state.optionGroupMappings;
      if (table === productMasterVariants) return state.variantMappings;
      if (table === productTagValues) return state.tagValueMappings;
      if (table === productMasterPricingRules) return state.pricingRuleMappings;
      return [];
    };

    const columnToRowKey: Record<string, string> = {
      id: 'id',
      master_id: 'masterId',
      version_id: 'versionId',
      purchase_constraint_id: 'purchaseConstraintId',
      variant_id: 'variantId',
      pricing_rule_id: 'pricingRuleId',
    };

    const isColumnChunk = (chunk: any) => chunk && typeof chunk.name === 'string' && chunk.table;
    const isParamChunk = (chunk: any) =>
      chunk &&
      Object.prototype.hasOwnProperty.call(chunk, 'value') &&
      Object.prototype.hasOwnProperty.call(chunk, 'encoder');

    const collectPredicates = (condition: any): Array<{ column: string; value: unknown }> => {
      const chunks = condition?.queryChunks;
      if (!Array.isArray(chunks)) {
        return [];
      }

      const column = chunks.find(isColumnChunk);
      const param = chunks.find(isParamChunk);
      if (column && param) {
        return [{ column: column.name, value: param.value }];
      }

      return chunks.flatMap((chunk) => collectPredicates(chunk));
    };

    const matchesWhere = (row: Record<string, unknown>, condition: any) =>
      collectPredicates(condition).every((predicate) => {
        const key = columnToRowKey[predicate.column] ?? predicate.column;
        return row[key] === predicate.value;
      });

    const projectRows = <T extends Record<string, unknown>>(rows: T[], selection?: Record<string, unknown>) => {
      if (!selection) {
        return rows;
      }

      return rows.map((row) =>
        Object.keys(selection).reduce<Record<string, unknown>>((projected, key) => {
          projected[key] = row[key];
          return projected;
        }, {}),
      );
    };

    const withLimit = <T extends Record<string, unknown>>(rows: T[]) => {
      const result = rows as T[] & { limit: (limit: number) => Promise<T[]> };
      result.limit = async (limit: number) => rows.slice(0, limit);
      return result;
    };

    return {
      state,
      select: jest.fn((selection?: Record<string, unknown>) => ({
        from: jest.fn((table: unknown) => ({
          where: jest.fn((condition: unknown) =>
            withLimit(
              projectRows(
                rowsForTable(table).filter((row) => matchesWhere(row, condition)),
                selection,
              ) as Record<string, unknown>[],
            ),
          ),
        })),
      })),
      delete: jest.fn((table: unknown) => ({
        where: jest.fn((condition: unknown) => {
          const rows = rowsForTable(table);
          const deletedRows: Record<string, unknown>[] = [];

          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (matchesWhere(rows[index], condition)) {
              deletedRows.push(rows[index]);
              rows.splice(index, 1);
            }
          }

          if (table === productMasterVersions) {
            for (const version of deletedRows) {
              for (let index = state.purchaseConstraintMappings.length - 1; index >= 0; index -= 1) {
                if (state.purchaseConstraintMappings[index].versionId === version.id) {
                  state.purchaseConstraintMappings.splice(index, 1);
                }
              }
            }
          }
        }),
      })),
    };
  }

  it('deletes a draft-only purchase constraint row after removing the draft mapping', async () => {
    const service = makeService();
    const tx = makeDeleteDraftTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      purchaseConstraints: [{ id: 'constraint-id', requiresMembership: true, lifetimeQuantityLimit: 3 }],
      purchaseConstraintMappings: [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    });

    await service.deleteDraftVersion('draft-version-id', tx as any);

    expect(tx.state.purchaseConstraintMappings).toEqual([]);
    expect(tx.state.purchaseConstraints).toEqual([]);
  });

  it('keeps a shared purchase constraint row when another version mapping still references it', async () => {
    const service = makeService();
    const tx = makeDeleteDraftTx({
      versions: [{ id: 'draft-version-id', masterId: 'master-id', status: 'draft' }],
      purchaseConstraints: [{ id: 'constraint-id', requiresMembership: true, lifetimeQuantityLimit: 3 }],
      purchaseConstraintMappings: [
        {
          id: 'draft-mapping-id',
          masterId: 'master-id',
          versionId: 'draft-version-id',
          purchaseConstraintId: 'constraint-id',
        },
        {
          id: 'active-mapping-id',
          masterId: 'master-id',
          versionId: 'active-version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    });

    await service.deleteDraftVersion('draft-version-id', tx as any);

    expect(tx.state.purchaseConstraintMappings).toEqual([
      {
        id: 'active-mapping-id',
        masterId: 'master-id',
        versionId: 'active-version-id',
        purchaseConstraintId: 'constraint-id',
      },
    ]);
    expect(tx.state.purchaseConstraints).toEqual([
      { id: 'constraint-id', requiresMembership: true, lifetimeQuantityLimit: 3 },
    ]);
  });
});
