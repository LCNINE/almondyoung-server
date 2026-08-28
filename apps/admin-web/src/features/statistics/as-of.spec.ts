import {
  asOfLabel,
  formatKstDateTime,
  kstDaysAgo,
  kstToday,
  stalenessNote,
  stalenessMinutes,
} from './as-of';

describe('formatKstDateTime', () => {
  it('UTC 로 도는 런타임에서도 KST 로 찍는다 — 9시간이 더해져야 한다', () => {
    expect(formatKstDateTime('2026-08-28T01:00:00.000Z')).toBe('2026-08-28 10:00');
  });

  it('UTC 자정 직전은 KST 로 다음 날 오전이다', () => {
    expect(formatKstDateTime('2026-08-27T23:30:00.000Z')).toBe('2026-08-28 08:30');
  });

  it('자정은 24시가 아니라 00시로 쓴다', () => {
    expect(formatKstDateTime('2026-08-27T15:00:00.000Z')).toBe('2026-08-28 00:00');
  });

  it('값이 없거나 파싱 불가면 null — 화면이 배지를 아예 안 그린다', () => {
    expect(formatKstDateTime(null)).toBeNull();
    expect(formatKstDateTime(undefined)).toBeNull();
    expect(formatKstDateTime('')).toBeNull();
    expect(formatKstDateTime('언제인지 모름')).toBeNull();
  });
});

describe('asOfLabel', () => {
  it('기준 시각 문구를 만든다', () => {
    expect(asOfLabel('2026-08-28T01:00:00.000Z')).toBe('2026-08-28 10:00 기준');
  });

  it('기준 시각이 없으면 null', () => {
    expect(asOfLabel(null)).toBeNull();
  });
});

describe('stalenessMinutes', () => {
  const now = new Date('2026-08-28T02:00:00.000Z');

  it('지금과의 차이를 분으로 준다', () => {
    expect(stalenessMinutes('2026-08-28T01:30:00.000Z', now)).toBe(30);
  });

  it('기준 시각이 미래면(시계 오차) 음수 대신 0', () => {
    expect(stalenessMinutes('2026-08-28T02:30:00.000Z', now)).toBe(0);
  });

  it('기준 시각이 없으면 판단 불가로 null', () => {
    expect(stalenessMinutes(null, now)).toBeNull();
  });
});

describe('stalenessNote', () => {
  const now = new Date('2026-08-28T02:00:00.000Z');

  it('임계 미만이면 아무 말도 하지 않는다 — 매번 경고하면 경고가 무뎌진다', () => {
    expect(stalenessNote('2026-08-28T01:40:00.000Z', now)).toBeNull();
  });

  it('30분부터 분으로 알린다', () => {
    expect(stalenessNote('2026-08-28T01:30:00.000Z', now)).toBe('집계가 30분 밀려 있습니다');
  });

  it('한 시간을 넘으면 시간으로, 하루를 넘으면 일로 줄여 쓴다', () => {
    expect(stalenessNote('2026-08-27T23:00:00.000Z', now)).toBe('집계가 3시간 밀려 있습니다');
    expect(stalenessNote('2026-08-26T01:00:00.000Z', now)).toBe('집계가 2일 밀려 있습니다');
  });

  it('기준 시각이 없으면 null', () => {
    expect(stalenessNote(undefined, now)).toBeNull();
  });
});

describe('kstToday', () => {
  it('UTC 로 도는 런타임에서도 KST 의 날짜를 준다', () => {
    expect(kstToday(new Date('2026-08-27T15:30:00.000Z'))).toBe('2026-08-28');
  });

  it('KST 자정 직전은 아직 전날이다', () => {
    expect(kstToday(new Date('2026-08-27T14:59:00.000Z'))).toBe('2026-08-27');
  });
});

describe('kstDaysAgo', () => {
  const now = new Date('2026-09-01T01:00:00.000Z');

  it('0 이면 오늘', () => {
    expect(kstDaysAgo(0, now)).toBe('2026-09-01');
  });

  it('월을 거슬러도 날짜가 밀리지 않는다', () => {
    expect(kstDaysAgo(1, now)).toBe('2026-08-31');
    expect(kstDaysAgo(6, now)).toBe('2026-08-26');
  });
});
