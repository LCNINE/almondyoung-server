import { TENANT_STAFF_ROLE } from '../tenant-staff-role';
import { fillGenerated, forbiddenWordsIn, isFilled, parseLivePlan, pickSlot, toTenantPlan } from './live-plan';

/**
 * 라이브 계획 파일 — 운영자가 레포 밖(또는 git 이 무시하는 곳)에 둔다. 테넌트 값은 이 파일에만 있다.
 * 버킷 이름(slug + 무작위 꼬리)과 칸 번호는 스크립트가 처음 한 번 정해 이 파일에 적는다 — 다시 돌려도 같은 이름이어야
 * «이미 됐나»가 성립한다.
 */
const raw = {
  id: '2',
  slug: 'acme',
  displayName: '에이크미',
  adminDomain: 'admin.acme.test',
  authDomain: 'login.acme.test',
  checkAccount: { loginId: 'acmecheck', email: 'check@acme.test' },
  staff: [{ loginId: 'kimstaff', username: '김직원', email: 'kim@acme.test' }],
};

describe('라이브 계획', () => {
  it('계획 → 만들기 단계의 계획: core DB·도메인 두 앱·리디렉트·역할·점검 계정', () => {
    const parsed = parseLivePlan({
      ...raw,
      publicBucket: 'acme-public-a1b2c3',
      privateBucket: 'acme-private-a1b2c3',
      slot: 1,
    });
    if (!isFilled(parsed)) throw new Error('채운 계획이어야 한다');
    const plan = toTenantPlan(parsed);

    expect(plan.entry).toEqual({
      id: '2',
      slug: 'acme',
      coreDb: 'core_acme',
      publicBucket: 'acme-public-a1b2c3',
      privateBucket: 'acme-private-a1b2c3',
    });
    expect(plan.domains).toEqual([
      { host: 'admin.acme.test', app: 'admin-web' },
      { host: 'login.acme.test', app: 'auth-web' },
    ]);
    expect(plan.staffClient).toEqual({
      clientId: 'admin-web',
      redirectUris: ['https://admin.acme.test/auth/callback'],
      postLogoutRedirectUris: ['https://admin.acme.test/login'],
    });
    expect(plan.role.permissions).toEqual([...TENANT_STAFF_ROLE.permissions]);
    expect(plan.checkAccount).toMatchObject({ loginId: 'acmecheck', email: 'check@acme.test' });
    expect(plan.staff).toEqual(raw.staff);
  });

  it('버킷 이름이 없으면 slug + 무작위 꼬리로 한 번 정한다 — 이미 있으면 그대로 둔다', () => {
    const first = fillGenerated(parseLivePlan(raw), { randomTail: () => 'a1b2c3', slot: 1 });
    expect(first.changed).toBe(true);
    expect(first.plan).toMatchObject({
      publicBucket: 'acme-public-a1b2c3',
      privateBucket: 'acme-private-a1b2c3',
      slot: 1,
    });

    const again = fillGenerated(first.plan, { randomTail: () => 'zzzzzz', slot: 7 });
    expect(again.changed).toBe(false);
    expect(again.plan).toEqual(first.plan);
  });

  it('금지어(아몬드영·LCNINE)는 대소문자 없이 잡는다', () => {
    expect(forbiddenWordsIn('acme-public-x1')).toEqual([]);
    expect(forbiddenWordsIn('AlmondYoung-files')).toEqual(['almond']);
    expect(forbiddenWordsIn('lcnine-acme')).toEqual(['lcnine']);
  });

  it('slug·버킷에 금지어가 있으면 계획을 거절한다 — 공개 버킷 이름은 그 테넌트 고객에게 보인다', () => {
    expect(() => parseLivePlan({ ...raw, slug: 'almondtwo' })).toThrow(/almond/);
    expect(() => parseLivePlan({ ...raw, publicBucket: 'acme-lcnine-1', privateBucket: 'acme-p-1' })).toThrow(/lcnine/);
  });

  it('우리 테넌트(ownBrand)는 금지어를 보지 않는다 — 기본은 본다', () => {
    const ours = { ...raw, slug: 'almondshop', adminDomain: 'admin.almond-shop.example' };
    expect(parseLivePlan({ ...ours, ownBrand: true }).adminDomain).toBe('admin.almond-shop.example');
    expect(() => parseLivePlan(ours)).toThrow(/almond/);
  });

  it('공개·비공개 버킷이 같으면 거절한다', () => {
    expect(() => parseLivePlan({ ...raw, publicBucket: 'acme-x1', privateBucket: 'acme-x1' })).toThrow(/달라야/);
  });

  it('두 도메인이 같거나 주소 꼴이 아니면 거절한다', () => {
    expect(() => parseLivePlan({ ...raw, authDomain: raw.adminDomain })).toThrow(/달라야/);
    expect(() => parseLivePlan({ ...raw, adminDomain: 'https://admin.acme.test' })).toThrow(/adminDomain/);
  });
});

describe('칸 번호', () => {
  it('이 테넌트 도메인이 이미 든 칸이 있으면 그 칸', () => {
    expect(pickSlot({ table: [1], slotDomains: new Map([[1, 'admin.acme.test']]), host: 'admin.acme.test' })).toBe(1);
  });

  it('없으면 표에도 Secret 에도 안 쓰인 가장 작은 번호', () => {
    expect(
      pickSlot({
        table: [1],
        slotDomains: new Map([
          [1, 'a.other.test'],
          [2, 'b.other.test'],
        ]),
        host: 'admin.acme.test',
      }),
    ).toBe(3);
    expect(pickSlot({ table: [], slotDomains: new Map(), host: 'admin.acme.test' })).toBe(1);
  });

  it('직원·점검 계정 아이디·이름은 user-service 계정 만들기 규칙으로 먼저 거절한다 — 끝 단계 400 이 아니라 시작 전에', () => {
    // 2026-11-03 테넌트 2 첫 직원: 배포·실측을 다 돈 뒤 POST /admin/auth 400 «이름은 최대 8자».
    const withStaff = (staff: unknown) => () => parseLivePlan({ ...raw, staff });
    expect(withStaff([{ loginId: 'kim-staff', username: '김직원', email: 'd@acme.test' }])).toThrow(
      /staff\.0\.loginId/,
    );
    expect(withStaff([{ loginId: 'abc', username: '김직원', email: 'd@acme.test' }])).toThrow(/staff\.0\.loginId/);
    expect(withStaff([{ loginId: 'kimstaff', username: '김직원 창고·상품 담당', email: 'd@acme.test' }])).toThrow(
      /staff\.0\.username/,
    );
    expect(withStaff([{ loginId: 'kimstaff', username: '데', email: 'd@acme.test' }])).toThrow(/staff\.0\.username/);
    expect(() => parseLivePlan({ ...raw, checkAccount: { loginId: 'Check', email: 'c@acme.test' } })).toThrow(
      /checkAccount\.loginId/,
    );
    expect(withStaff([{ loginId: 'kimstaff', username: '김 창고담당', email: 'd@acme.test' }])).not.toThrow();
  });
});
