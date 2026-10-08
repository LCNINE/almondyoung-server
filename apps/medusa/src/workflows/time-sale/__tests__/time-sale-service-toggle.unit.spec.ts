import { PriceListStatus } from '@medusajs/framework/utils';
import {
  defaultSaleDisplay,
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
} from '../../../../../../packages/domain-types/time-sale';
import { planTimeSaleServiceToggle } from '../save-time-sale-settings';
import { nextSuspendedPriceListIds, shouldCheckTimeSaleOverlap } from '../save-time-sale';

const settings = (enabled: boolean, suspendedPriceListIds: string[] = []) => {
  const base = defaultTimeSaleSettings();

  return { ...base, environment: { ...base.environment, enabled, suspendedPriceListIds } };
};

const group = (generalId: string | null, membershipId: string | null) => ({
  generalId,
  membershipId,
  productId: null,
  startsAt: null,
  endsAt: null,
});

const sales = [
  {
    saleId: 'sale-a',
    groups: [group('plist_a', 'plist_am')],
    priceListIds: ['plist_a', 'plist_am'],
    productIds: ['prod_a'],
  },
  { saleId: 'sale-b', groups: [group('plist_b', null)], priceListIds: ['plist_b'], productIds: ['prod_b'] },
];

describe('planTimeSaleServiceToggle', () => {
  it('ON→OFF: active 가격표만 기록하고 draft 로 바꾼다', () => {
    const plan = planTimeSaleServiceToggle(settings(true), settings(false), sales, ['plist_a', 'plist_am']);

    expect(plan.settings.environment.suspendedPriceListIds).toEqual(['plist_a', 'plist_am']);
    expect(plan.updates).toEqual([
      { id: 'plist_a', status: PriceListStatus.DRAFT },
      { id: 'plist_am', status: PriceListStatus.DRAFT },
    ]);
    expect(plan.productIds).toEqual(['prod_a']);
  });

  it('OFF→ON: 기록한 것 중 아직 있는 가격표만 active, 목록은 비운다', () => {
    const plan = planTimeSaleServiceToggle(settings(false, ['plist_a', 'plist_gone']), settings(true), sales, []);

    expect(plan.settings.environment.suspendedPriceListIds).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'plist_a', status: PriceListStatus.ACTIVE }]);
  });

  it('전환이 아니면 상태는 그대로, 중지 목록은 클라이언트 값 대신 서버 값', () => {
    const plan = planTimeSaleServiceToggle(settings(false, ['plist_a']), settings(false, ['plist_x']), sales, []);

    expect(plan.updates).toEqual([]);
    expect(plan.settings.environment.suspendedPriceListIds).toEqual(['plist_a']);
  });

  it('OFF→ON: 회차가 지난 반복 세일은 다음 회차로 옮기고, 반복이 끝났으면 켜지 않는다', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const iso = (h: number) => new Date(now + h * 3600000).toISOString();
    const ended = { productId: null, startsAt: iso(-5), endsAt: iso(-4) };
    const repeating = [
      {
        saleId: 'r',
        groups: [{ ...ended, generalId: 'plist_r', membershipId: null }],
        priceListIds: ['plist_r'],
        productIds: [],
      },
      {
        saleId: 'd',
        groups: [{ ...ended, generalId: 'plist_d', membershipId: null }],
        priceListIds: ['plist_d'],
        productIds: [],
      },
    ];
    const next = settings(true);
    const display = (repeatUntil: string | null) => ({ ...defaultSaleDisplay(), repeatHours: 2, repeatUntil });
    next.sales = { r: display(null), d: display(iso(1.5)) };

    const plan = planTimeSaleServiceToggle(settings(false, ['plist_r', 'plist_d']), next, repeating, [], now);

    expect(plan.updates).toEqual([
      { id: 'plist_r', status: PriceListStatus.ACTIVE, starts_at: iso(1), ends_at: iso(2) },
    ]);
    expect(plan.settings.environment.suspendedPriceListIds).toEqual([]);
  });

  it('active 가 200개를 넘으면 끌 수 없다', () => {
    const ids = Array.from({ length: 201 }, (_, i) => `plist_${i}`);

    expect(() => planTimeSaleServiceToggle(settings(true), settings(false), sales, ids)).toThrow('200개');
  });
});

describe('nextSuspendedPriceListIds', () => {
  const groups = [{ generalId: 'plist_new', membershipId: null, productId: null, startsAt: '', endsAt: '' }];

  it('활성 요청이면 옛 id 를 빼고 새 id 를 넣는다', () => {
    expect(
      nextSuspendedPriceListIds(['plist_old', 'plist_other'], { replacedIds: ['plist_old'], groups, status: 'active' }),
    ).toEqual(['plist_other', 'plist_new']);
  });

  it('중지 목록에 없던 세일을 초안으로 저장하면 넣지 않는다', () => {
    expect(nextSuspendedPriceListIds(['plist_other'], { replacedIds: ['plist_old'], groups, status: 'draft' })).toEqual(
      ['plist_other'],
    );
  });

  it('OFF 로 중지된 세일은 초안 상태로 수정해도 새 id 로 중지 목록에 남는다', () => {
    expect(
      nextSuspendedPriceListIds(['plist_old', 'plist_other'], { replacedIds: ['plist_old'], groups, status: 'draft' }),
    ).toEqual(['plist_other', 'plist_new']);
  });

  it('id 가 그대로인 중지 세일을 초안 상태로 수정해도 중지 목록에 남는다', () => {
    expect(
      nextSuspendedPriceListIds(['plist_new', 'plist_other'], { replacedIds: ['plist_new'], groups, status: 'draft' }),
    ).toEqual(['plist_other', 'plist_new']);
  });
});

describe('shouldCheckTimeSaleOverlap', () => {
  it('활성 요청은 검사하고, 중지 목록에 없는 초안은 건너뛴다', () => {
    expect(shouldCheckTimeSaleOverlap('active', ['plist_x'], ['plist_a'])).toBe(true);
    expect(shouldCheckTimeSaleOverlap('draft', ['plist_x'], ['plist_a'])).toBe(false);
  });

  it('OFF 로 중지된 세일은 초안 요청이어도 켤 때 되살아나므로 검사한다', () => {
    expect(shouldCheckTimeSaleOverlap('draft', ['plist_a'], ['plist_a', 'plist_am'])).toBe(true);
  });
});

describe('validateTimeSaleSettings suspendedPriceListIds', () => {
  it('없으면 통과(옛 설정), 200개 초과·문자열 아님은 거절', () => {
    const legacy = defaultTimeSaleSettings();
    const { suspendedPriceListIds: _omit, ...environment } = legacy.environment;

    expect(() => validateTimeSaleSettings({ ...legacy, environment })).not.toThrow();
    expect(() =>
      validateTimeSaleSettings(
        settings(
          false,
          Array.from({ length: 201 }, (_, i) => `plist_${i}`),
        ),
      ),
    ).toThrow();
    expect(() =>
      validateTimeSaleSettings({ ...legacy, environment: { ...legacy.environment, suspendedPriceListIds: [1] } }),
    ).toThrow();
  });
});
