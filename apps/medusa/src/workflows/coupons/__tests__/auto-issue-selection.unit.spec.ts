import { foldGrantResults, selectAutoIssueCandidates } from '../auto-issue-selection';

const NOW = new Date('2026-09-05T00:00:00Z');
const groupRule = (groupId: string, operator = 'in') => ({
  attribute: 'customer.groups.id',
  operator,
  values: [{ value: groupId }],
});

const select = (
  metas: Parameters<typeof selectAutoIssueCandidates>[0]['metas'],
  promotions: Parameters<typeof selectAutoIssueCandidates>[0]['promotions'],
  customerGroupIds: string[] = [],
) =>
  selectAutoIssueCandidates({
    trigger: 'customer_registered',
    customerId: 'cus_1',
    customerGroupIds: new Set(customerGroupIds),
    metas,
    promotions,
    now: NOW,
  });

describe('selectAutoIssueCandidates — 라우트 루프의 순수 판', () => {
  it('게이트를 다 넘은 프로모션은 결정적 issue_key 로 요청이 된다', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only', validity_days: 30, max_claims: '5' }],
      [{ id: 'p1', code: 'WELCOME', rules: [] }],
    );

    expect(out.skipped).toEqual([]);
    expect(out.codeById.get('p1')).toBe('WELCOME');
    expect(out.requests).toEqual([
      {
        promotion_id: 'p1',
        customer_id: 'cus_1',
        issue_keys: ['trigger:customer_registered'],
        issued_via: 'customer_registered',
        expires_at: new Date('2026-10-05T00:00:00Z').toISOString(),
        max_claims: 5,
        enforce_cap: true,
      },
    ]);
  });

  it('메타 행이 없는 프로모션은 조용히 건너뛴다 (요청도 스킵도 아님)', () => {
    const out = select([], [{ id: 'p1', code: 'X', rules: [] }]);
    expect(out.requests).toEqual([]);
    expect(out.skipped).toEqual([]);
  });

  it('public 쿠폰은 public_promotion 으로 스킵한다 (#488 A2)', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'public' }],
      [{ id: 'p1', code: 'X', rules: [] }],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'public_promotion' }]);
    expect(out.requests).toEqual([]);
  });

  it('발급창 밖은 not_started / expired 로 스킵한다', () => {
    const out = select(
      [
        { promotion_id: 'p1', visibility: 'assigned_only', starts_at: '2026-09-06T00:00:00Z' },
        { promotion_id: 'p2', visibility: 'assigned_only', ends_at: '2026-09-04T00:00:00Z' },
      ],
      [
        { id: 'p1', code: 'A', rules: [] },
        { id: 'p2', code: 'B', rules: [] },
      ],
    );
    expect(out.skipped).toEqual([
      { promotion_id: 'p1', reason: 'not_started' },
      { promotion_id: 'p2', reason: 'expired' },
    ]);
  });

  it('그룹 룰은 평가한다 — 불일치는 group_mismatch', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [groupRule('grp_other')] }],
      ['grp_mine'],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'group_mismatch' }]);
  });

  it('분류표 밖 룰은 unsupported_rule 로 스킵하고 로그용 좌표를 남긴다 (#488 1-5)', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [groupRule('grp_x', 'ne')] }],
    );
    expect(out.skipped).toEqual([{ promotion_id: 'p1', reason: 'unsupported_rule' }]);
    expect(out.unsupportedRules).toEqual([
      { promotion_id: 'p1', attribute: 'customer.groups.id', operator: 'ne' },
    ]);
  });

  it('max_claims 가 없으면 null, expires_at 이 없으면 null', () => {
    const out = select(
      [{ promotion_id: 'p1', visibility: 'assigned_only' }],
      [{ id: 'p1', code: 'A', rules: [] }],
    );
    expect(out.requests[0].max_claims).toBeNull();
    expect(out.requests[0].expires_at).toBeNull();
  });
});

describe('foldGrantResults — verdict 를 응답 모양으로', () => {
  const codeById = new Map([['p1', 'A'], ['p2', 'B'], ['p3', 'C'], ['p4', 'D']]);
  const r = (promotion_id: string, verdict: any, error?: string) => ({
    promotion_id,
    customer_id: 'cus_1',
    verdict,
    created: verdict === 'issued' ? 1 : 0,
    duplicated: verdict === 'already_issued' ? 1 : 0,
    ...(error ? { error } : {}),
  });

  it('issued/partial → issued, already_issued → skipped, exhausted → max_claims_exceeded, error → failed', () => {
    const out = foldGrantResults(
      [r('p1', 'issued'), r('p2', 'already_issued'), r('p3', 'exhausted'), r('p4', 'error', 'boom')],
      codeById,
    );
    expect(out.issued).toEqual([{ promotion_id: 'p1', code: 'A' }]);
    expect(out.skipped).toEqual([
      { promotion_id: 'p2', reason: 'already_issued' },
      { promotion_id: 'p3', reason: 'max_claims_exceeded' },
    ]);
    expect(out.failed).toEqual([{ promotion_id: 'p4', error: 'boom' }]);
  });

  it('코드를 모르는 프로모션은 빈 코드로 (방어)', () => {
    const out = foldGrantResults([r('p9', 'issued')], codeById);
    expect(out.issued).toEqual([{ promotion_id: 'p9', code: '' }]);
  });
});
