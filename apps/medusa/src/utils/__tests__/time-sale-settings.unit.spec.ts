import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { normalizeLegacySales, repeatTimeSales, timeSalePrivacyConflicts } from '../time-sale-settings';
import {
  defaultSaleDisplay,
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  nextRepeatedPeriod,
  repeatTooShortFor,
} from '../../../../../packages/domain-types/time-sale';

describe('time-sale settings trust boundary', () => {
  it('rejects executable CSS, invalid image sizes and multiple product containers', () => {
    const settings = defaultTimeSaleSettings();
    settings.environment.imageSize = 0;
    expect(() => validateTimeSaleSettings(settings)).toThrow();
    settings.environment.imageSize = 100;
    settings.styles.main.mobile.components.push({
      ...settings.styles.main.mobile.components[0],
      id: 'unsafe',
      css: { backgroundImage: 'url(javascript:alert(1))' },
    });
    expect(() => validateTimeSaleSettings(settings)).toThrow();
  });
  it('advances repeats across missed cycles and stops at the repeat deadline', () => {
    expect(
      nextRepeatedPeriod('2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z', 24, null, Date.parse('2026-10-09T02:00:00Z')),
    ).toEqual({ startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-10-10T01:00:00.000Z' });
    expect(
      nextRepeatedPeriod(
        '2026-10-07T00:00:00Z',
        '2026-10-07T01:00:00Z',
        24,
        '2026-10-09T00:30:00Z',
        Date.parse('2026-10-09T02:00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('settings.sales 키와 상품별 그룹', () => {
  const saleId = '0f8fad5b-d9cb-469f-a165-70867728950e';

  const withSale = (key: string, display: ReturnType<typeof defaultSaleDisplay>) => {
    const settings = defaultTimeSaleSettings();
    settings.sales[key] = display;
    return settings;
  };

  it('옛 plist_ 키와 UUID 키를 둘 다 받고 그 밖의 키는 거절한다', () => {
    expect(() => validateTimeSaleSettings(withSale('plist_01ABC', defaultSaleDisplay()))).not.toThrow();
    expect(() => validateTimeSaleSettings(withSale(saleId, defaultSaleDisplay()))).not.toThrow();
    expect(() => validateTimeSaleSettings(withSale('not-a-uuid', defaultSaleDisplay()))).toThrow();
    expect(() => validateTimeSaleSettings(withSale(`${saleId}x`, defaultSaleDisplay()))).toThrow();
  });

  it('groups 가 없는 옛 노출 설정도 읽는다', () => {
    const legacy: Record<string, unknown> = { ...defaultSaleDisplay() };
    delete legacy.groups;
    delete legacy.periodMode;
    const settings = defaultTimeSaleSettings();
    settings.sales.plist_01ABC = legacy as never;

    expect(() => validateTimeSaleSettings(settings)).not.toThrow();
  });

  it('상품별 모드는 상품 200개까지, 상품 id 가 겹치면 거절한다', () => {
    const groups = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        generalId: `plist_g${i}`,
        membershipId: null,
        productId: `prod_${i}`,
      }));
    const product = (count: number) => ({
      ...defaultSaleDisplay(),
      periodMode: 'product' as const,
      groups: groups(count),
    });

    expect(() => validateTimeSaleSettings(withSale(saleId, product(200)))).not.toThrow();
    expect(() => validateTimeSaleSettings(withSale(saleId, product(201)))).toThrow();

    const duplicated = product(2);
    duplicated.groups[1].productId = 'prod_0';
    expect(() => validateTimeSaleSettings(withSale(saleId, duplicated))).toThrow();
  });

  it('세일 단위 모드는 상품 없는 그룹 하나뿐이다', () => {
    const display = {
      ...defaultSaleDisplay(),
      groups: [{ generalId: 'plist_g', membershipId: 'plist_m', productId: 'prod_1' }],
    };

    expect(() => validateTimeSaleSettings(withSale(saleId, display))).toThrow();
  });
});

describe('repeatTimeSales lock', () => {
  it('세일 저장과 같은 time-sale-write 락을 자기 owner 로 잡은 뒤에 읽고 쓰고, 그 owner 로만 푼다', async () => {
    const events: string[] = [];
    const settings = defaultTimeSaleSettings();
    settings.environment.enabled = true;
    settings.sales.plist_general = { ...defaultSaleDisplay(), repeatHours: 24 };

    const lockCall = (name: string) =>
      jest.fn(async (key: string, args?: { ownerId?: string }) => {
        events.push(`${name} ${key} ${args?.ownerId ?? '*'}`);
        return true;
      });
    const registry: Record<string, unknown> = {
      [Modules.LOCKING]: {
        acquire: lockCall('acquire'),
        release: lockCall('release'),
        execute: jest.fn(async (key: string, job: () => Promise<unknown>) => {
          events.push(`execute:${key}`);
          return job();
        }),
      },
      [Modules.STORE]: {
        listStores: jest.fn(async () => {
          events.push('read-settings');
          return [{ id: 'store', metadata: { timeSaleSettings: settings } }];
        }),
      },
      [Modules.PRICING]: {
        updatePriceLists: jest.fn(async () => {
          events.push('update-period');
        }),
      },
      [ContainerRegistrationKeys.PG_CONNECTION]: {
        raw: jest.fn(async (sql: string) => {
          events.push('read-lists');
          if (!sql.includes('from price_list pl')) return { rows: [] };
          return {
            rows: [
              {
                id: 'plist_general',
                title: '반복',
                status: 'active',
                starts_at: '2026-01-01T00:00:00Z',
                ends_at: '2026-01-01T01:00:00Z',
                is_membership_only: false,
              },
            ],
          };
        }),
      },
    };

    await repeatTimeSales({ resolve: (key: string) => registry[key] } as never);

    const acquire = events[0];
    const owner = acquire.split(' ')[2];

    expect(acquire.startsWith('acquire time-sale-write ')).toBe(true);
    expect(owner).not.toBe('*');
    expect(events.slice(1, -1)).toEqual(expect.arrayContaining(['read-settings', 'read-lists', 'update-period']));
    expect(events.at(-1)).toBe(`release time-sale-write ${owner}`);
  });

  it('저장이 락을 쥐고 있으면 이번 회차는 읽지도 쓰지도 않고 건너뛴다', async () => {
    const touched: string[] = [];
    const release = jest.fn();
    const registry: Record<string, unknown> = {
      [Modules.LOCKING]: {
        acquire: jest.fn(async () => {
          throw new Error('Failed to acquire lock for key "time-sale-write"');
        }),
        release,
        execute: jest.fn(async (_key: string, job: () => Promise<unknown>) => job()),
      },
      [Modules.STORE]: { listStores: jest.fn(async () => touched.push('read-settings')) },
      [Modules.PRICING]: { updatePriceLists: jest.fn(async () => touched.push('update-period')) },
      [ContainerRegistrationKeys.PG_CONNECTION]: { raw: jest.fn(async () => touched.push('read-lists')) },
      [ContainerRegistrationKeys.LOGGER]: { info: jest.fn(), warn: jest.fn() },
    };

    await repeatTimeSales({ resolve: (key: string) => registry[key] } as never);

    expect(touched).toEqual([]);
    expect(release).not.toHaveBeenCalled();
  });
});

describe('repeatTimeSales 상품별 기간', () => {
  it('그룹마다 자기 기간으로 다음 회차를 따로 계산한다', async () => {
    const settings = defaultTimeSaleSettings();
    settings.sales['0f8fad5b-d9cb-469f-a165-70867728950e'] = {
      ...defaultSaleDisplay(),
      repeatHours: 24,
      periodMode: 'product',
      groups: [
        { generalId: 'plist_a', membershipId: null, productId: 'prod_a' },
        { generalId: 'plist_b', membershipId: null, productId: 'prod_b' },
      ],
    };
    const updates: unknown[] = [];
    const list = (id: string, startsAt: string, endsAt: string) => ({
      id,
      title: '상품별',
      status: 'active',
      starts_at: startsAt,
      ends_at: endsAt,
      is_membership_only: false,
    });
    const registry: Record<string, unknown> = {
      [Modules.LOCKING]: { acquire: jest.fn(), release: jest.fn() },
      [Modules.STORE]: {
        listStores: jest.fn(async () => [{ id: 'store', metadata: { timeSaleSettings: settings } }]),
      },
      [Modules.PRICING]: { updatePriceLists: jest.fn(async (data: unknown) => updates.push(data)) },
      [ContainerRegistrationKeys.PG_CONNECTION]: {
        raw: jest.fn(async (sql: string) => {
          if (!sql.includes('from price_list pl')) return { rows: [] };
          return {
            rows: [
              list('plist_a', '2026-01-01T04:00:00Z', '2026-01-01T05:00:00Z'),
              list('plist_b', '2026-01-01T06:00:00Z', '2026-01-01T07:00:00Z'),
            ],
          };
        }),
      },
    };

    await repeatTimeSales({ resolve: (key: string) => registry[key] } as never);

    const flat = (updates as { id: string; starts_at: string; ends_at: string }[][]).flat();
    const a = flat.find((u) => u.id === 'plist_a');
    const b = flat.find((u) => u.id === 'plist_b');

    const day = 24 * 3600000;
    const gap = a && Date.parse(b?.starts_at ?? '') - Date.parse(a.starts_at);

    expect(gap === undefined ? NaN : ((gap % day) + day) % day).toBe(2 * 3600000);
    expect(a && Date.parse(a.ends_at) - Date.parse(a.starts_at)).toBe(3600000);
    expect(b && Date.parse(b.ends_at) - Date.parse(b.starts_at)).toBe(3600000);
  });
});

describe('반복 간격 검증', () => {
  const period = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });

  it('그룹마다 자기 기간 + 10분보다 짧은 반복 간격을 찾는다', () => {
    const short = period('2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z');
    const long = period('2026-10-07T00:00:00Z', '2026-10-07T03:00:00Z');

    expect(repeatTooShortFor(2, [short])).toBeNull();
    expect(repeatTooShortFor(2, [short, long])).toBe(long);
  });

  it('반복이 없으면 검사하지 않고, 대표 기간이 넓어도 그룹 기간만 본다', () => {
    const a = period('2026-10-07T13:00:00Z', '2026-10-07T14:00:00Z');
    const b = period('2026-10-07T15:00:00Z', '2026-10-07T16:00:00Z');

    expect(repeatTooShortFor(0, [period('2026-10-07T00:00:00Z', '2026-10-09T00:00:00Z')])).toBeNull();
    expect(repeatTooShortFor(2, [a, b])).toBeNull();
  });
});

describe('옛 노출 설정 정규화', () => {
  it('groups 가 없는 옛 세일에 세일 단위 묶음을 채운다', () => {
    const settings = defaultTimeSaleSettings();
    const legacy: Record<string, unknown> = { ...defaultSaleDisplay(), order: 3 };
    delete legacy.groups;
    delete legacy.periodMode;
    settings.sales.plist_g = legacy as never;
    settings.sales.plist_gone = legacy as never;

    const normalized = normalizeLegacySales(settings, [
      { saleId: 'plist_g', groups: [{ generalId: 'plist_g', membershipId: 'plist_m', productId: null }] },
    ]);

    expect(normalized.sales.plist_g).toMatchObject({
      order: 3,
      periodMode: 'sale',
      groups: [{ generalId: 'plist_g', membershipId: 'plist_m', productId: null }],
    });
    expect(normalized.sales.plist_gone).toMatchObject({ periodMode: 'sale', groups: [] });
    expect(() => validateTimeSaleSettings(normalized)).not.toThrow();
  });
});

describe('timeSalePrivacyConflicts', () => {
  const sales = [
    { saleId: 'public-with-general', title: '일반 세일', groups: [{ generalId: 'plist_g' }] },
    { saleId: 'membership-only', title: '멤버십 세일', groups: [{ generalId: null }] },
  ];

  const withFlags = (env: boolean, perSale: Record<string, boolean> = {}) => {
    const settings = defaultTimeSaleSettings();
    settings.environment.membershipPriceOnly = env;
    for (const sale of sales)
      settings.sales[sale.saleId] = { ...defaultSaleDisplay(), membershipPriceOnly: perSale[sale.saleId] ?? false };

    return settings;
  };

  it('rejects turning sales private through the settings endpoint', () => {
    expect(timeSalePrivacyConflicts(withFlags(false), withFlags(true), sales)).toEqual(['일반 세일', '멤버십 세일']);
    expect(
      timeSalePrivacyConflicts(withFlags(false), withFlags(false, { 'public-with-general': true }), sales),
    ).toEqual(['일반 세일']);
  });

  it('rejects turning a sale private even when it has no general price list', () => {
    expect(timeSalePrivacyConflicts(withFlags(false), withFlags(false, { 'membership-only': true }), sales)).toEqual([
      '멤버십 세일',
    ]);
  });

  it('rejects turning a private sale public because it has no general sale price', () => {
    const before = withFlags(false, { 'membership-only': true });

    expect(timeSalePrivacyConflicts(before, withFlags(false), sales)).toEqual(['멤버십 세일']);
  });

  it('ignores saves that do not change any sale privacy', () => {
    const before = withFlags(true, { 'membership-only': true, 'public-with-general': true });
    const after = withFlags(false, { 'membership-only': true, 'public-with-general': true });

    expect(timeSalePrivacyConflicts(before, after, sales)).toEqual([]);
  });
});

describe('상품별 사용자 변수 값 검증', () => {
  const settingsWith = (productVariables: unknown) => {
    const settings = defaultTimeSaleSettings();
    settings.variables = [{ name: 'user_x', description: '', preview: '' }];
    settings.sales.plist_01ABC = { ...defaultSaleDisplay(), productVariables } as never;

    return settings;
  };

  it('정의된 변수의 상품별 값을 받는다', () => {
    expect(() => validateTimeSaleSettings(settingsWith({ prod_1: { user_x: '회원 혜택' } }))).not.toThrow();
  });

  it('정의되지 않은 변수·긴 값·변수 수 초과·상품 수 초과를 거절한다', () => {
    expect(() => validateTimeSaleSettings(settingsWith({ prod_1: { user_y: 'a' } }))).toThrow();
    expect(() => validateTimeSaleSettings(settingsWith({ prod_1: { user_x: 'a'.repeat(257) } }))).toThrow();
    expect(() => validateTimeSaleSettings(settingsWith({ prod_1: ['a'] }))).toThrow();

    const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`prod_${i}`, { user_x: 'a' }]));
    expect(() => validateTimeSaleSettings(settingsWith(tooMany))).toThrow();
  });

  it('옛 variables 필드는 무시하고 productVariables 가 없어도 읽는다', () => {
    const legacy: Record<string, unknown> = { ...defaultSaleDisplay(), variables: { user_zzz: 'x' } };
    delete legacy.productVariables;
    const settings = defaultTimeSaleSettings();
    settings.sales.plist_01ABC = legacy as never;

    expect(() => validateTimeSaleSettings(settings)).not.toThrow();
  });
});
