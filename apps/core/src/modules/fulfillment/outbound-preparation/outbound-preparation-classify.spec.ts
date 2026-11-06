import {
  classifyPreparation,
  isSingleItem,
  PreparationBucket,
  PreparationFacts,
  resolvePlanProfileId,
} from './outbound-preparation-classify';

describe('classifyPreparation', () => {
  const readyFacts: PreparationFacts = {
    status: 'draft',
    hasActiveWorkItem: false,
    lines: [{ qty: 2, confirmedQty: 2 }],
    profileIds: ['p1'],
    recipientComplete: true,
    consolidationPeerLines: [],
  };

  it('분할 직후 미예약 상자만 같은 그룹에 남으면 원래 상자는 ready다', () => {
    expect(
      classifyPreparation({
        ...readyFacts,
        consolidationPeerLines: [[{ qty: 1, confirmedQty: 0 }]],
      }),
    ).toBe('ready');
  });

  it.each<{ name: string; facts: Partial<PreparationFacts>; expected: PreparationBucket | null }>([
    { name: '전량 예약되고 정보가 완전하면 ready', facts: {}, expected: 'ready' },
    {
      name: '준비 완료된 합포장 그룹이면 mergeable',
      facts: { consolidationPeerLines: [[{ qty: 1, confirmedQty: 1 }]] },
      expected: 'mergeable',
    },
    {
      name: '한 라인만 전량 예약되면 partial',
      facts: {
        lines: [
          { qty: 2, confirmedQty: 2 },
          { qty: 1, confirmedQty: 0 },
        ],
      },
      expected: 'partial',
    },
    {
      name: '모든 라인에 예약이 있어도 수량이 부족하면 partial',
      facts: {
        lines: [
          { qty: 1, confirmedQty: 1 },
          { qty: 3, confirmedQty: 1 },
        ],
      },
      expected: 'partial',
    },
    {
      name: '모든 라인의 예약이 0이면 unavailable',
      facts: {
        lines: [
          { qty: 2, confirmedQty: 0 },
          { qty: 1, confirmedQty: 0 },
        ],
      },
      expected: 'unavailable',
    },
    { name: '프로필이 서로 다르면 needs_info', facts: { profileIds: ['p1', 'p2'] }, expected: 'needs_info' },
    { name: '프로필 일부가 없으면 needs_info', facts: { profileIds: ['p1', null] }, expected: 'needs_info' },
    { name: '프로필이 없으면 needs_info', facts: { profileIds: [null] }, expected: 'needs_info' },
    { name: '프로필 목록이 비면 needs_info', facts: { profileIds: [] }, expected: 'needs_info' },
    { name: '수령인 정보가 불완전하면 needs_info', facts: { recipientComplete: false }, expected: 'needs_info' },
    { name: 'planned이고 활성 작업이 없으면 resume', facts: { status: 'planned' }, expected: 'resume' },
    {
      name: 'planned이고 활성 작업이 있으면 대상 제외',
      facts: { status: 'planned', hasActiveWorkItem: true },
      expected: null,
    },
    { name: 'draft이고 활성 작업이 있으면 대상 제외', facts: { hasActiveWorkItem: true }, expected: null },
    {
      name: 'planned이면 예약과 정보 부족보다 resume이 우선',
      facts: {
        status: 'planned',
        lines: [{ qty: 1, confirmedQty: 0 }],
        profileIds: [null],
        recipientComplete: false,
        consolidationPeerLines: [[{ qty: 1, confirmedQty: 1 }]],
      },
      expected: 'resume',
    },
    {
      name: '예약이 없으면 정보 부족과 합포장 그룹보다 unavailable이 우선',
      facts: {
        lines: [{ qty: 1, confirmedQty: 0 }],
        profileIds: [null],
        recipientComplete: false,
        consolidationPeerLines: [[{ qty: 1, confirmedQty: 1 }]],
      },
      expected: 'unavailable',
    },
    {
      name: '일부 예약이면 정보 부족과 합포장 그룹보다 partial이 우선',
      facts: {
        lines: [{ qty: 2, confirmedQty: 1 }],
        profileIds: [null],
        recipientComplete: false,
        consolidationPeerLines: [[{ qty: 1, confirmedQty: 1 }]],
      },
      expected: 'partial',
    },
    {
      name: '정보가 부족하면 합포장 그룹보다 needs_info가 우선',
      facts: { recipientComplete: false, consolidationPeerLines: [[{ qty: 1, confirmedQty: 1 }]] },
      expected: 'needs_info',
    },
    { name: '라인이 없으면 unavailable', facts: { lines: [] }, expected: 'unavailable' },
  ])('$name', ({ facts, expected }) => {
    expect(classifyPreparation({ ...readyFacts, ...facts })).toBe(expected);
  });
});

describe('resolvePlanProfileId', () => {
  it.each<{ profileIds: (string | null)[]; expected: string | null }>([
    { profileIds: ['p1'], expected: 'p1' },
    { profileIds: ['p1', 'p1'], expected: 'p1' },
    { profileIds: ['p1', 'p2'], expected: null },
    { profileIds: ['p1', null], expected: null },
    { profileIds: [null, 'p1'], expected: null },
    { profileIds: [null], expected: null },
    { profileIds: [], expected: null },
  ])('$profileIds → $expected', ({ profileIds, expected }) => {
    expect(resolvePlanProfileId(profileIds)).toBe(expected);
  });
});

describe('isSingleItem', () => {
  it.each<{ lines: { qty: number }[]; expected: boolean }>([
    { lines: [], expected: false },
    { lines: [{ qty: 1 }], expected: true },
    { lines: [{ qty: 5 }], expected: true },
    { lines: [{ qty: 1 }, { qty: 1 }], expected: false },
  ])('$lines → $expected', ({ lines, expected }) => {
    expect(isSingleItem(lines)).toBe(expected);
  });
});
