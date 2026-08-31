import {
  computeExpiresAt,
  issuanceWindowState,
  isWithinIssuanceWindow,
  isUsable,
  displayExpiresAt,
} from '../validity';

const NOW = new Date('2026-08-31T00:00:00.000Z');

describe('computeExpiresAt — 발급 시점에 링크 행에 박을 값', () => {
  it('validity_days 가 있으면 발급일 + N일', () => {
    expect(computeExpiresAt({ validity_days: 30 }, NOW)).toEqual(
      new Date('2026-09-30T00:00:00.000Z'),
    );
  });

  it('validity_days 가 문자열로 와도(숫자 컬럼의 DB 표현) 계산된다', () => {
    expect(computeExpiresAt({ validity_days: '7' }, NOW)).toEqual(
      new Date('2026-09-07T00:00:00.000Z'),
    );
  });

  it('validity_days 가 없으면 정책의 절대 만료일을 그대로 박는다', () => {
    expect(computeExpiresAt({ ends_at: '2026-12-31T23:59:59.000Z' }, NOW)).toEqual(
      new Date('2026-12-31T23:59:59.000Z'),
    );
  });

  it('validity_days 가 ends_at 보다 우선한다 — 둘 다 있으면 상대가 이긴다', () => {
    expect(
      computeExpiresAt({ validity_days: 10, ends_at: '2026-12-31T00:00:00.000Z' }, NOW),
    ).toEqual(new Date('2026-09-10T00:00:00.000Z'));
  });

  it('둘 다 없으면 무기한(null)', () => {
    expect(computeExpiresAt({}, NOW)).toBeNull();
    expect(computeExpiresAt(null, NOW)).toBeNull();
  });
});

describe('issuanceWindowState — 지금 발급할 수 있는가', () => {
  it('창이 없으면 항상 ok', () => {
    expect(issuanceWindowState({}, NOW)).toEqual('ok');
    expect(issuanceWindowState(null, NOW)).toEqual('ok');
  });

  it('시작 전이면 not_started', () => {
    expect(issuanceWindowState({ starts_at: '2999-01-01T00:00:00.000Z' }, NOW)).toEqual(
      'not_started',
    );
  });

  it('종료 후면 ended', () => {
    expect(issuanceWindowState({ ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toEqual('ended');
  });

  it('경계는 포함이다 — 시작 시각 정각과 종료 시각 정각 모두 ok', () => {
    expect(issuanceWindowState({ starts_at: NOW }, NOW)).toEqual('ok');
    expect(issuanceWindowState({ ends_at: NOW }, NOW)).toEqual('ok');
  });

  it('isWithinIssuanceWindow 는 ok 여부다', () => {
    expect(isWithinIssuanceWindow({ ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isWithinIssuanceWindow({}, NOW)).toBe(true);
  });
});

describe('isUsable — 링크 행이 있으면 그 행이, 없으면 정책이 만료를 정한다', () => {
  it('발급된 장은 정책 창이 지나도 자기 만료까지 산다 — 이 작업의 존재 이유', () => {
    const policy = { ends_at: '2000-01-01T00:00:00.000Z' };
    const instance = { expires_at: '2026-09-30T00:00:00.000Z' };
    expect(isUsable(instance, policy, NOW)).toBe(true);
  });

  it('발급된 장의 만료가 지났으면 못 쓴다', () => {
    expect(isUsable({ expires_at: '2026-08-30T23:59:59.000Z' }, {}, NOW)).toBe(false);
  });

  it('링크가 없으면(=public) 정책의 ends_at 이 만료다', () => {
    expect(isUsable(null, { ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isUsable(null, { ends_at: '2999-01-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('링크는 있는데 expires_at 이 NULL 이면 무기한이다 (옛 링크·롤링 중 발급)', () => {
    expect(isUsable({ expires_at: null }, { ends_at: '2000-01-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('시작 전이면 발급 여부와 무관하게 못 쓴다', () => {
    const policy = { starts_at: '2999-01-01T00:00:00.000Z' };
    expect(isUsable(null, policy, NOW)).toBe(false);
    expect(isUsable({ expires_at: '2999-12-31T00:00:00.000Z' }, policy, NOW)).toBe(false);
  });

  it('정책도 링크도 비어 있으면 무기한', () => {
    expect(isUsable(null, null, NOW)).toBe(true);
  });
});

describe('displayExpiresAt — 스토어 응답에 내보낼 만료 표시값 (isUsable 과 같은 규칙)', () => {
  it('링크가 있으면 링크의 expires_at 을 그대로 쓴다', () => {
    const instance = { expires_at: '2026-12-31T00:00:00.000Z' };
    const policy = { ends_at: '2000-01-01T00:00:00.000Z' };
    expect(displayExpiresAt(instance, policy)).toEqual('2026-12-31T00:00:00.000Z');
  });

  it('«링크는 있는데 expires_at 이 NULL(무기한)」이면 null 이다 — 정책 ends_at 으로 새면 안 된다', () => {
    const instance = { expires_at: null };
    const policy = { ends_at: '2026-12-31T00:00:00.000Z' };
    expect(displayExpiresAt(instance, policy)).toBeNull();
  });

  it('링크가 없으면 정책의 ends_at 이다', () => {
    expect(displayExpiresAt(null, { ends_at: '2026-12-31T00:00:00.000Z' })).toEqual(
      '2026-12-31T00:00:00.000Z',
    );
  });

  it('링크도 없고 정책도 없으면(또는 ends_at 없으면) null(무기한)이다', () => {
    expect(displayExpiresAt(null, null)).toBeNull();
    expect(displayExpiresAt(null, {})).toBeNull();
  });
});
