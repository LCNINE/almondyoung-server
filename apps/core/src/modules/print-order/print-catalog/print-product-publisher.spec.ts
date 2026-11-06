import { BadRequestError } from '@app/shared';
import type { DbService } from '@app/db';
import type { MergedSchema } from '../../../platform/database/merged-schema';
import type { ProductMastersService } from '../../catalog/core/products/services/product-masters.service';
import type { ProductVersionsService } from '../../catalog/core/products/services/product-versions.service';
import type { ProductVariantsService } from '../../catalog/core/products/services/product-variants.service';
import type { PricingService } from '../../catalog/core/pricing/pricing.service';
import type { OptionReadLoader } from '../../catalog/core/products/loaders/option-read.loader';
import type { BulkSessionComboResolver } from '../../catalog/operations/bulk-session/services/bulk-session.combos';
import type { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import type { WowpressLineSpec } from '../wowpress/wowpress.types';
import type { PrintCatalogReader } from './print-catalog.reader';
import { PrintProductPublisher, type PublishPrintProductInput } from './print-product-publisher';

const TX = { name: 'outer-tx' };
const MASTER = 'm-new';
const VERSION = 'v-1';

const idKey = (...ids: string[]): string => [...ids].sort().join('+');

const baseSpec = (qty: number): WowpressLineSpec => ({
  prodno: 40073,
  jobpresetno: '3110',
  prsjob: [{ covercd: 0, sizeno: 5458 }],
  awkjob: [],
  qtyPerUnit: qty,
  file: { format: 'pdf', dpi: 300 },
  design: { productId: '', widthMm: 90, heightMm: 50 },
  confirmed: false,
});

const input = (overrides: Partial<PublishPrintProductInput> = {}): PublishPrintProductInput => ({
  templateId: 'tpl-1',
  kind: 'bizcard',
  width: 90,
  height: 50,
  name: '아몬드 명함',
  description: '템플릿 명함',
  thumbnailFileId: 'file-1',
  combos: [
    {
      key: 'a',
      paperno: 1,
      colorno: 10,
      qty: 100,
      awk: [],
      price: 6000,
      memberPrice: 5500,
      optionLabels: { paper: '아트지', side: '단면', qty: '100매' },
    },
    {
      key: 'b',
      paperno: 1,
      colorno: 20,
      qty: 100,
      awk: [],
      price: 5000,
      memberPrice: 4500,
      optionLabels: { paper: '아트지', side: '양면', qty: '100매' },
    },
  ],
  ...overrides,
});

describe('PrintProductPublisher', () => {
  const run = jest.fn();
  const quotes = jest.fn();
  const specFor = jest.fn();
  const claimTemplate = jest.fn();
  const assignClaimedMaster = jest.fn();
  const insertSpecs = jest.fn();
  const createMaster = jest.fn();
  const updateVersion = jest.fn();
  const publishVersion = jest.fn();
  const bulkUpdateVariantsInDraft = jest.fn();
  const replaceVersionRules = jest.fn();
  const getOptionGroups = jest.fn();
  const resolveExisting = jest.fn();

  const publisher = new PrintProductPublisher(
    { run } as unknown as DbService<MergedSchema>,
    { quotes, specFor } as unknown as PrintCatalogReader,
    { claimTemplate, assignClaimedMaster, insertSpecs } as unknown as PrintProductSpecRepository,
    { createMaster, updateVersion } as unknown as ProductMastersService,
    { publishVersion } as unknown as ProductVersionsService,
    { bulkUpdateVariantsInDraft } as unknown as ProductVariantsService,
    { replaceVersionRules } as unknown as PricingService,
    { getOptionGroups } as unknown as OptionReadLoader,
    { resolveExisting } as unknown as BulkSessionComboResolver,
  );

  const groups = [
    { id: 'g-paper', displayName: '용지', values: [{ id: 'pv1', displayName: '아트지' }] },
    {
      id: 'g-side',
      displayName: '면',
      values: [
        { id: 'sv1', displayName: '단면' },
        { id: 'sv2', displayName: '양면' },
      ],
    },
    { id: 'g-qty', displayName: '수량', values: [{ id: 'qv1', displayName: '100매' }] },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    run.mockImplementation((fn: (tx: unknown) => Promise<unknown>, tx?: unknown) => fn(tx ?? TX));
    quotes.mockResolvedValue([
      { key: 'a', verdict: { ok: true, supply: 4100, bill: 4510 } },
      { key: 'b', verdict: { ok: true, supply: 4100, bill: 4510 } },
    ]);
    specFor.mockImplementation((_kind: string, _size: unknown, combo: { qty: number }) =>
      Promise.resolve(baseSpec(combo.qty)),
    );
    claimTemplate.mockResolvedValue({ claimed: true });
    createMaster.mockResolvedValue({ id: VERSION, masterId: MASTER });
    getOptionGroups.mockResolvedValue(groups);
    resolveExisting.mockResolvedValue(
      new Map([
        [idKey('pv1', 'sv1', 'qv1'), 'var-a'],
        [idKey('pv1', 'sv2', 'qv1'), 'var-b'],
      ]),
    );
  });

  it('publishes master, options, prices, specs and claims the template in one transaction', async () => {
    const result = await publisher.publish(input(), 'admin-1');

    expect(result).toEqual({ masterId: MASTER, created: true });

    expect(claimTemplate.mock.calls[0][2]).toBe(TX);
    expect(assignClaimedMaster).toHaveBeenCalledWith('tpl-1', MASTER, TX);
    expect(createMaster).toHaveBeenCalledWith('admin-1', TX);
    expect(updateVersion.mock.calls[0][3]).toBe(TX);
    expect(getOptionGroups.mock.calls[0][0]).toBe(TX);
    expect(resolveExisting.mock.calls[0][2]).toBe(TX);
    expect(replaceVersionRules.mock.calls[0][2]).toBe(TX);
    expect(insertSpecs.mock.calls[0][1]).toBe(TX);
    expect(publishVersion).toHaveBeenCalledWith(VERSION, 'admin-1', TX);

    const [versionId, data] = updateVersion.mock.calls[0];
    expect(versionId).toBe(VERSION);
    expect(data).toMatchObject({ name: '아몬드 명함', description: '템플릿 명함', thumbnailFileId: 'file-1' });
    expect(data.optionDiff.add.map((g: { displayName: string }) => g.displayName)).toEqual(['용지', '면', '수량']);
    expect(data.optionDiff.add[1].values.map((v: { displayName: string }) => v.displayName)).toEqual(['단면', '양면']);

    const rules = replaceVersionRules.mock.calls[0][1];
    expect(rules.basePriceRules[0]).toEqual({
      layer: 'base_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: 5000,
    });
    expect(rules.basePriceRules.slice(1)).toEqual([
      expect.objectContaining({ order: 2, scopeType: 'variants', scopeTargetIds: ['var-a'], operationValue: 6000 }),
      expect.objectContaining({ order: 3, scopeType: 'variants', scopeTargetIds: ['var-b'], operationValue: 5000 }),
    ]);
    expect(rules.membershipPriceRules[0]).toMatchObject({ order: 1, scopeType: 'all_variants', operationValue: 4500 });
    expect(rules.membershipPriceRules).toHaveLength(3);

    const rows = insertSpecs.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { variantId: string }) => r.variantId)).toEqual(['var-a', 'var-b']);
    for (const row of rows) {
      expect(row.spec.design).toEqual({ productId: MASTER, widthMm: 90, heightMm: 50 });
    }

    expect(bulkUpdateVariantsInDraft).not.toHaveBeenCalled();
  });

  it('returns the existing master when the template was already published', async () => {
    claimTemplate.mockResolvedValue({ claimed: false, masterId: 'm-1' });

    await expect(publisher.publish(input(), 'admin-1')).resolves.toEqual({ masterId: 'm-1', created: false });

    expect(createMaster).not.toHaveBeenCalled();
    expect(insertSpecs).not.toHaveBeenCalled();
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it('rejects a price at or below the quoted cost', async () => {
    const combos = input().combos.map((c) => (c.key === 'b' ? { ...c, price: 4100, memberPrice: null } : c));

    await expect(publisher.publish(input({ combos }), 'admin-1')).rejects.toThrow(BadRequestError);

    expect(run).not.toHaveBeenCalled();
    expect(createMaster).not.toHaveBeenCalled();
  });

  it('rejects when a member price is at or below cost', async () => {
    const combos = input().combos.map((c) => (c.key === 'b' ? { ...c, memberPrice: 4000 } : c));

    await expect(publisher.publish(input({ combos }), 'admin-1')).rejects.toThrow(BadRequestError);

    expect(createMaster).not.toHaveBeenCalled();
  });

  it('leaves nothing when spec insert fails', async () => {
    insertSpecs.mockRejectedValue(new Error('insert failed'));

    await expect(publisher.publish(input(), 'admin-1')).rejects.toThrow('insert failed');

    expect(run).toHaveBeenCalledTimes(1);
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it('rejects a quote that came back as failed', async () => {
    quotes.mockResolvedValue([
      { key: 'a', verdict: { ok: true, supply: 4100, bill: 4510 } },
      { key: 'b', verdict: { ok: false, reason: 'no price' } },
    ]);

    await expect(publisher.publish(input(), 'admin-1')).rejects.toThrow(BadRequestError);

    expect(run).not.toHaveBeenCalled();
  });

  it('turns off generated combinations the admin did not select', async () => {
    resolveExisting.mockResolvedValue(
      new Map([
        [idKey('pv1', 'sv1', 'qv1'), 'var-a'],
        [idKey('pv1', 'sv2', 'qv1'), 'var-b'],
        [idKey('pv1', 'sv3', 'qv1'), 'var-extra'],
      ]),
    );

    await publisher.publish(input(), 'admin-1');

    expect(bulkUpdateVariantsInDraft).toHaveBeenCalledWith(
      MASTER,
      VERSION,
      [{ id: 'var-extra', status: 'inactive' }],
      TX,
    );
  });

  it('rejects two combinations with the same option labels', async () => {
    const combos = input().combos.map((c) => ({ ...c, optionLabels: { paper: '아트지', side: '단면', qty: '100매' } }));

    await expect(publisher.publish(input({ combos }), 'admin-1')).rejects.toThrow(BadRequestError);

    expect(quotes).not.toHaveBeenCalled();
  });

  it('only adds an all-variant member price when every combination has one', async () => {
    const combos = input().combos.map((c) => (c.key === 'a' ? { ...c, memberPrice: null } : c));

    await publisher.publish(input({ combos }), 'admin-1');

    const rules = replaceVersionRules.mock.calls[0][1];
    expect(rules.membershipPriceRules).toEqual([
      expect.objectContaining({ order: 1, scopeType: 'variants', scopeTargetIds: ['var-b'], operationValue: 4500 }),
    ]);
  });
});
