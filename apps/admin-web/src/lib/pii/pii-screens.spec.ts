import {
  piiNoticeStatus,
  resolvePiiScreen,
  resolvePiiScreenIn,
  standingPiiNotice,
} from './pii-screens';

const C = { opens: 'customer' } as const;
const R = { opens: 'recipient' } as const;
const D = { opens: 'customer', reveal: true } as const;
const DD = { opens: 'customer', reveal: true, revealScope: 'detail' } as const;
const RA = { opens: 'recipient', recipientCoversAll: true } as const;
const RAD = {
  opens: 'recipient',
  reveal: true,
  recipientCoversAll: true,
} as const;
const ready = (keys: string[]) => ({
  status: 'ready' as const,
  held: new Set(keys),
});

const NO_PERMISSION = {
  text: '이 화면의 개인정보는 가려져 보입니다 — 개인정보 보기 권한이 없습니다.',
  showReveal: false,
};
const RECIPIENT_ONLY = {
  text: '이 화면의 개인정보 일부가 가려져 보입니다 — 받는 분 정보만 볼 수 있는 권한입니다.',
  showReveal: false,
};
const MASKED_DETAIL = {
  text: '개인정보가 가려져 있습니다 — [보기]를 누르면 원문이 열리고 열람 기록이 남습니다.',
  showReveal: true,
};
const MASKED_LIST = {
  text: '개인정보가 가려져 있습니다 — 상세 화면에서 [보기]로 원문을 열 수 있습니다.',
  showReveal: false,
};

describe('resolvePiiScreenIn', () => {
  it('상위 경로를 물려받고, 실제 id 가 든 경로를 [id] 키에 맞춘다', () => {
    expect(
      resolvePiiScreenIn({ '/customer-window': C }, '/customer-window/[id]')
    ).toEqual(C);
    expect(
      resolvePiiScreenIn({ '/customer-window': C }, '/customer-window/abc')
    ).toEqual(C);
    expect(
      resolvePiiScreenIn(
        { '/order/history/[id]': D, '/order/history': C },
        '/order/history/42'
      )
    ).toEqual(D);
    expect(
      resolvePiiScreenIn({ '/customer-window': C }, '/attendance')
    ).toBeNull();
  });

  it('정확히 같은 키가 동적 키보다 우선한다', () => {
    const table = { '/a/[id]': C, '/a/new': D };
    expect(resolvePiiScreenIn(table, '/a/new')).toEqual(D);
    expect(resolvePiiScreenIn(table, '/a/7')).toEqual(C);
  });

  it('동적 키가 겹치면 고정 조각이 많은 쪽을 고른다', () => {
    const table = { '/a/[x]/[y]': C, '/a/[x]/edit': D };
    expect(resolvePiiScreenIn(table, '/a/1/edit')).toEqual(D);
    expect(resolvePiiScreenIn(table, '/a/1/2')).toEqual(C);
  });

  it('null 키는 안내 없음 — 같은 깊이의 [id] 키도 상위 키도 물려받지 않는다', () => {
    const table = { '/a': C, '/a/[id]': D, '/a/log': null };
    expect(resolvePiiScreenIn(table, '/a/log')).toBeNull();
    expect(resolvePiiScreenIn(table, '/a/log/3')).toBeNull();
    expect(resolvePiiScreenIn(table, '/a/7')).toEqual(D);
  });

  it('하위 경로가 표에 없으면 한 조각씩 올라가 찾는다', () => {
    expect(
      resolvePiiScreenIn(
        { '/order/history/[id]': D },
        '/order/history/42/notes'
      )
    ).toEqual(D);
  });
});

describe('resolvePiiScreen', () => {
  it('실제 표 — 상세는 [id] 키로, 개인정보 없는 형제 화면은 null 로 판정된다', () => {
    expect(resolvePiiScreen('/users/u-1')).toEqual(D);
    expect(resolvePiiScreen('/users/roles')).toBeNull();
    expect(resolvePiiScreen('/order/fulfillments/f-1')).toEqual({
      ...RAD,
      revealScope: 'detail',
    });
    expect(resolvePiiScreen('/order/inspection')).toEqual(RAD);
    expect(resolvePiiScreen('/order/stall-board')).toEqual(RA);
    expect(resolvePiiScreen('/attendance')).toBeNull();
  });
});

describe('standingPiiNotice', () => {
  it('개인정보 화면이 아니면 안내 없음', () => {
    expect(
      standingPiiNotice({
        ...ready([]),
        screen: null,
        revealRequired: false,
        reveal: 'idle' as const,
      })
    ).toBeNull();
  });

  it('권한 확인 전에는 안내 없음', () => {
    for (const status of ['loading', 'error'] as const)
      expect(
        standingPiiNotice({
          status,
          held: new Set(),
          screen: C,
          revealRequired: false,
          reveal: 'idle' as const,
        })
      ).toBeNull();
  });

  it('원문 권한자·스위치 꺼짐 → 안내 없음', () => {
    for (const screen of [C, R, D])
      expect(
        standingPiiNotice({
          ...ready(['customer.pii.read']),
          screen,
          revealRequired: false,
          reveal: 'idle' as const,
        })
      ).toBeNull();
  });

  it('권한 없음', () => {
    expect(
      standingPiiNotice({
        ...ready([]),
        screen: C,
        revealRequired: false,
        reveal: 'idle' as const,
      })
    ).toEqual(NO_PERMISSION);
  });

  it('수령인 화면 + 수령인 권한만 → 일부 가림, 스위치와 무관', () => {
    for (const revealRequired of [false, true])
      expect(
        standingPiiNotice({
          ...ready(['fulfillment.recipient.read']),
          screen: R,
          revealRequired,
          reveal: 'idle' as const,
        })
      ).toEqual(RECIPIENT_ONLY);
  });

  it('수령인 권한만 + 고객 화면 → 권한 없음', () => {
    expect(
      standingPiiNotice({
        ...ready(['fulfillment.recipient.read']),
        screen: C,
        revealRequired: false,
        reveal: 'idle' as const,
      })?.text
    ).toContain('권한이 없습니다');
  });

  it('수령인 화면 + 권한 없음 → 권한 없음', () => {
    expect(
      standingPiiNotice({
        ...ready([]),
        screen: R,
        revealRequired: true,
        reveal: 'idle' as const,
      })
    ).toEqual(NO_PERMISSION);
  });

  it('수령인 화면 + 원문 권한자 + 스위치 켜짐 → 기본 가림', () => {
    const base = {
      ...ready(['customer.pii.read']),
      revealRequired: true,
      reveal: 'idle' as const,
    };
    expect(standingPiiNotice({ ...base, screen: R })).toEqual(MASKED_LIST);
  });

  it('수령인 화면 + 두 권한 모두 → 수령인 규칙이 아니라 기본 가림', () => {
    expect(
      standingPiiNotice({
        ...ready(['customer.pii.read', 'fulfillment.recipient.read']),
        screen: R,
        revealRequired: true,
        reveal: 'idle' as const,
      })
    ).toEqual(MASKED_LIST);
  });

  it('기본 가림 — 상세는 [보기], 목록은 안내만', () => {
    const base = { ...ready(['customer.pii.read']), revealRequired: true };
    expect(standingPiiNotice({ ...base, screen: D, reveal: 'idle' })).toEqual(
      MASKED_DETAIL
    );
    expect(standingPiiNotice({ ...base, screen: C, reveal: 'idle' })).toEqual(
      MASKED_LIST
    );
  });

  it('[보기] 뒤 원문 재조회가 끝나기 전에는 기본 가림 문구를 두고 버튼만 숨긴다', () => {
    const base = { ...ready(['customer.pii.read']), revealRequired: true };
    expect(
      standingPiiNotice({ ...base, screen: D, reveal: 'pending' })
    ).toEqual({ ...MASKED_DETAIL, showReveal: false });
  });

  it('원문 재조회가 성공한 뒤에만 보기 중 문구', () => {
    const base = { ...ready(['customer.pii.read']), revealRequired: true };
    expect(standingPiiNotice({ ...base, screen: D, reveal: 'shown' })).toEqual({
      text: '원문 표시 중 — 이 화면을 떠나면 다시 가려집니다(열람 기록이 남습니다).',
      showReveal: false,
    });
  });
});

describe('standingPiiNotice — [보기]가 화면 안 상세만 여는 화면', () => {
  const base = { ...ready(['customer.pii.read']), revealRequired: true };
  const BEFORE =
    '개인정보가 가려져 있습니다 — [보기]를 누르면 이 화면에서 여는 상세의 원문이 열리고 열람 기록이 남습니다.';

  it('누르기 전·재조회 중에는 상세만 열린다고 알린다', () => {
    expect(standingPiiNotice({ ...base, screen: DD, reveal: 'idle' })).toEqual({
      text: BEFORE,
      showReveal: true,
    });
    expect(
      standingPiiNotice({ ...base, screen: DD, reveal: 'pending' })
    ).toEqual({ text: BEFORE, showReveal: false });
  });

  it('원문을 받은 뒤에도 목록은 가려진 채라고 알린다', () => {
    expect(standingPiiNotice({ ...base, screen: DD, reveal: 'shown' })).toEqual(
      {
        text: '상세 원문 표시 중 — 목록은 가려진 채로 보입니다. 이 화면을 떠나면 다시 가려집니다(열람 기록이 남습니다).',
        showReveal: false,
      }
    );
  });

  it('실제 표 — 목록과 상세를 함께 그리는 화면은 상세만 연다', () => {
    expect(resolvePiiScreen('/messages/inbox')).toEqual(DD);
    expect(resolvePiiScreen('/order/history')).toEqual(DD);
  });
});

describe('standingPiiNotice — 받는 분 정보로 전부 열리는 화면', () => {
  const at = (keys: string[], revealRequired: boolean, screen = RA) =>
    standingPiiNotice({
      ...ready(keys),
      screen,
      revealRequired,
      reveal: 'idle',
    });

  it('받는 분 정보 권한자는 스위치와 무관하게 안내 없음', () => {
    for (const revealRequired of [false, true]) {
      expect(at(['fulfillment.recipient.read'], revealRequired)).toBeNull();
      expect(
        at(
          ['customer.pii.read', 'fulfillment.recipient.read'],
          revealRequired,
          RAD
        )
      ).toBeNull();
    }
  });

  it('고객 개인정보 권한만 + 스위치 켜짐 → 기본 가림(서버가 그 권한만으로 열린 값은 가린다)', () => {
    expect(at(['customer.pii.read'], true)).toEqual(MASKED_LIST);
    expect(at(['customer.pii.read'], true, RAD)).toEqual(MASKED_DETAIL);
    expect(at(['customer.pii.read'], false)).toBeNull();
  });

  it('권한이 없으면 권한 없음', () => {
    expect(at([], false)).toEqual(NO_PERMISSION);
  });
});

describe('piiNoticeStatus', () => {
  const prior = { permissions: new Set<string>() };

  it('이전 권한이 남은 채 재조회가 실패하면 판정 불가 — «권한 없음» 안내를 띄우지 않는다', () => {
    const status = piiNoticeStatus({ isError: true, data: prior });
    expect(status).toBe('error');
    expect(
      standingPiiNotice({
        status,
        held: prior.permissions,
        screen: C,
        revealRequired: false,
        reveal: 'idle',
      })
    ).toBeNull();
  });

  it('첫 로딩·성공', () => {
    expect(piiNoticeStatus({ isError: false, data: undefined })).toBe(
      'loading'
    );
    expect(piiNoticeStatus({ isError: false, data: prior })).toBe('ready');
    expect(piiNoticeStatus({ isError: true, data: undefined })).toBe('error');
  });
});
