import {
  fieldCaptureActorOf,
  likeContains,
  normalizePositionCode,
  shelfOf,
  summarizeRemaining,
} from './sku-field-capture.rules';

describe('normalizePositionCode', () => {
  it('앞뒤 공백을 지우고 대문자로', () => expect(normalizePositionCode('  t-01-20 \n')).toBe('T-01-20'));
  it('한글 위치는 그대로', () => expect(normalizePositionCode('케이영 창고')).toBe('케이영 창고'));
});

describe('fieldCaptureActorOf', () => {
  it('토큰에 실명이 있으면 이름을 label 로', () =>
    expect(fieldCaptureActorOf({ userId: 'u1', name: '정중식', login_id: 'worker01' })).toEqual({
      workerId: 'u1',
      workerLabel: '정중식',
    }));
  it('이름이 없으면(옛 토큰) login_id', () =>
    expect(fieldCaptureActorOf({ userId: 'u1', login_id: 'worker01', email: 'w@x.kr' })).toEqual({
      workerId: 'u1',
      workerLabel: 'worker01',
    }));
  it('login_id 없으면 email', () =>
    expect(fieldCaptureActorOf({ id: 'u2', email: 'w@x.kr' })).toEqual({ workerId: 'u2', workerLabel: 'w@x.kr' }));
  it('id 가 없으면 던진다', () => expect(() => fieldCaptureActorOf({ email: 'w@x.kr' })).toThrow());
});

describe('likeContains', () => {
  it('%·_·\\ 를 글자 그대로 찾게 감싼다', () => expect(likeContains('50%_a\\b')).toBe('%50\\%\\_a\\\\b%'));
});

describe('shelfOf', () => {
  it('한 글자 줄', () => expect(shelfOf('A-08-36')).toEqual({ row: 'A', shelf: 'A-08' }));
  it('두 글자 줄', () => expect(shelfOf('AA-10-05')).toEqual({ row: 'AA', shelf: 'AA-10' }));
  it('꼴이 다르면 null', () => expect(shelfOf('O21-36-')).toEqual({ row: null, shelf: null }));
  it('위치 없음', () => expect(shelfOf(null)).toEqual({ row: null, shelf: null }));
});

describe('summarizeRemaining', () => {
  const src = (code: string, positionCode: string | null, captured: boolean) => ({
    skuId: code,
    code,
    name: code,
    positionCode,
    qty: 1,
    captured,
  });

  const { rows, items } = summarizeRemaining([
    src('s1', 'AA-01-01', false),
    src('s2', 'B-02-01', true),
    src('s3', 'B-01-02', false),
    src('s4', 'T-01-01', false),
    src('s5', null, false),
    src('s6', 'B-01-01', false),
  ]);

  it('줄 요약은 한 글자 줄 먼저, T 는 빠진다', () =>
    expect(rows).toEqual([
      { row: 'B', completed: 1, remaining: 2 },
      { row: 'AA', completed: 0, remaining: 1 },
    ]));

  it('미완료만 줄 → 위치 순, 위치 없는 건 맨 뒤, T 는 빠진다', () =>
    expect(items.map((i) => i.code)).toEqual(['s6', 's3', 's1', 's5']));
});
