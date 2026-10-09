import { latestBatch, reconstruct, type BackupFile, type BackupPrice } from './reconstruct';

const price = (list: string, variant: string, amount: number, createdAt: string, deletedAt: string | null = null): BackupPrice => ({
  id: `${list}_${variant}_${createdAt}`,
  price_list_id: list,
  variant_id: variant,
  amount: String(amount),
  created_at: createdAt,
  deleted_at: deletedAt,
});

describe('latestBatch', () => {
  it('takes the prices of the newest created_at minute', () => {
    const map = latestBatch([
      price('g', 'v1', 900, '2026-10-07T11:45:10.000Z'),
      price('g', 'v1', 900, '2026-10-07T12:12:03.000Z'),
      price('g', 'v2', 800, '2026-10-07T12:12:04.000Z'),
    ]);
    expect([...map.entries()]).toEqual([
      ['v1', 900],
      ['v2', 800],
    ]);
  });

  it('throws when batches disagree on an amount', () => {
    expect(() =>
      latestBatch([price('g', 'v1', 900, '2026-10-07T11:45:00.000Z'), price('g', 'v1', 850, '2026-10-07T12:12:00.000Z')]),
    ).toThrow(/v1/);
  });
});

describe('reconstruct', () => {
  const backup: BackupFile = {
    exportedAt: '2026-10-09T02:50:00.000Z',
    lists: [],
    rules: [],
    prices: [
      price('g', 'v1', 900, '2026-10-07T11:45:00.000Z'),
      price('g', 'v2', 800, '2026-10-07T11:45:00.000Z'),
      price('m1', 'v1', 700, '2026-10-07T11:45:00.000Z'),
      price('m2', 'v1', 700, '2026-10-07T12:18:00.000Z'),
    ],
  };
  const target = {
    name: '복구 ①',
    generalListId: 'g',
    membershipListIds: ['m1', 'm2'],
    status: 'draft' as const,
    startsAt: '2026-10-08T15:00:00.000Z',
    endsAt: '2026-10-16T14:59:00.000Z',
  };

  it('builds a draft body and a summary', () => {
    const [entry] = reconstruct(backup, [target]);
    expect(entry.body).toEqual({
      title: '복구 ①',
      starts_at: '2026-10-08T15:00:00.000Z',
      ends_at: '2026-10-16T14:59:00.000Z',
      status: 'draft',
      general_prices: [
        { variant_id: 'v1', amount: 900 },
        { variant_id: 'v2', amount: 800 },
      ],
      membership_prices: [{ variant_id: 'v1', amount: 700 }],
    });
    expect(entry.summary).toEqual({ generalCount: 2, generalSum: 1700, membershipCount: 1, membershipSum: 700 });
  });

  it('throws when two membership lists disagree', () => {
    const conflicting = { ...backup, prices: [...backup.prices, price('m2', 'v1', 650, '2026-10-07T12:19:00.000Z')] };
    expect(() => reconstruct(conflicting, [target])).toThrow();
  });

  it('throws when a target list has no prices in the backup', () => {
    expect(() => reconstruct(backup, [{ ...target, generalListId: 'missing' }])).toThrow(/missing/);
  });
});
