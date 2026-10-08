import { overlapsWithRepeats } from '../time-sale';

const once = (startsAt: string, endsAt: string) => ({ startsAt, endsAt, repeatHours: 0, repeatUntil: null });

describe('overlapsWithRepeats', () => {
  it('반복 세일은 반복 종료가 없으면 상대 기간까지 회차를 펼쳐 겹침을 찾는다', () => {
    expect(
      overlapsWithRepeats(
        { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 24, repeatUntil: null },
        once('2026-10-09T00:30:00Z', '2026-10-09T02:00:00Z'),
      ),
    ).toBe(true);
  });

  it('반복 종료 이후 회차는 비교하지 않는다', () => {
    expect(
      overlapsWithRepeats(
        {
          startsAt: '2026-10-07T00:00:00Z',
          endsAt: '2026-10-07T01:00:00Z',
          repeatHours: 24,
          repeatUntil: '2026-10-08T00:30:00Z',
        },
        once('2026-10-09T00:30:00Z', '2026-10-09T02:00:00Z'),
      ),
    ).toBe(false);
  });

  it('경계가 맞닿기만 하면 겹치지 않는다', () => {
    expect(
      overlapsWithRepeats(
        once('2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z'),
        once('2026-10-07T01:00:00Z', '2026-10-07T02:00:00Z'),
      ),
    ).toBe(false);
  });

  it('반복 회차의 경계가 맞닿기만 해도 겹치지 않는다', () => {
    expect(
      overlapsWithRepeats(
        { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 24, repeatUntil: null },
        once('2026-10-09T01:00:00Z', '2026-10-09T23:00:00Z'),
      ),
    ).toBe(false);
  });

  it('인자 순서와 무관하다', () => {
    const repeating = {
      startsAt: '2026-10-07T00:00:00Z',
      endsAt: '2026-10-07T01:00:00Z',
      repeatHours: 24,
      repeatUntil: null,
    };
    const single = once('2026-10-09T00:30:00Z', '2026-10-09T02:00:00Z');

    expect(overlapsWithRepeats(single, repeating)).toBe(true);
  });

  it('둘 다 끝없이 반복하면 주기가 엇갈려도 언젠가 만나는지 본다', () => {
    const a = { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 24, repeatUntil: null };
    const meets = {
      startsAt: '2026-10-07T05:00:00Z',
      endsAt: '2026-10-07T06:00:00Z',
      repeatHours: 25,
      repeatUntil: null,
    };
    const never = {
      startsAt: '2026-10-07T05:00:00Z',
      endsAt: '2026-10-07T06:00:00Z',
      repeatHours: 24,
      repeatUntil: null,
    };

    expect(overlapsWithRepeats(a, meets)).toBe(true);
    expect(overlapsWithRepeats(a, never)).toBe(false);
  });

  it('반복 간격이 기간보다 10분 이상 길지 않으면 반복하지 않는 것으로 본다', () => {
    expect(
      overlapsWithRepeats(
        { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T01:00:00Z', repeatHours: 1, repeatUntil: null },
        once('2026-10-07T03:00:00Z', '2026-10-07T04:00:00Z'),
      ),
    ).toBe(false);
  });

  it('소수 시간 반복도 몇 년 뒤 회차까지 정확히 찾는다', () => {
    expect(
      overlapsWithRepeats(
        { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T00:01:00Z', repeatHours: 0.2, repeatUntil: null },
        once('2029-01-17T08:12:30Z', '2029-01-17T08:20:00Z'),
      ),
    ).toBe(true);
    expect(
      overlapsWithRepeats(
        { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T00:01:00Z', repeatHours: 0.2, repeatUntil: null },
        once('2029-01-17T08:13:00Z', '2029-01-17T08:20:00Z'),
      ),
    ).toBe(false);
  });

  it('반복 종료가 첫 시작보다 앞서도 첫 회차는 적용된다', () => {
    const first = {
      startsAt: '2026-10-07T00:00:00Z',
      endsAt: '2026-10-07T01:00:00Z',
      repeatHours: 24,
      repeatUntil: '2026-10-06T00:00:00Z',
    };

    expect(overlapsWithRepeats(first, first)).toBe(true);
  });

  it('둘 다 유한하게 오래 반복해도 끝 무렵 회차의 겹침을 찾는다', () => {
    expect(
      overlapsWithRepeats(
        {
          startsAt: '2026-10-07T00:00:00Z',
          endsAt: '2026-10-07T00:01:00Z',
          repeatHours: 0.2,
          repeatUntil: '2036-01-01T00:00:00Z',
        },
        {
          startsAt: '2035-12-31T00:05:00Z',
          endsAt: '2035-12-31T00:06:00Z',
          repeatHours: 0.2,
          repeatUntil: '2035-12-31T23:00:00Z',
        },
      ),
    ).toBe(false);
    expect(
      overlapsWithRepeats(
        {
          startsAt: '2026-10-07T00:00:00Z',
          endsAt: '2026-10-07T00:01:00Z',
          repeatHours: 0.2,
          repeatUntil: '2036-01-01T00:00:00Z',
        },
        {
          startsAt: '2035-12-31T00:00:30Z',
          endsAt: '2035-12-31T00:01:30Z',
          repeatHours: 0.25,
          repeatUntil: '2035-12-31T23:00:00Z',
        },
      ),
    ).toBe(true);
  });

  it('날짜를 읽을 수 없으면 겹친 것으로 본다', () => {
    expect(
      overlapsWithRepeats(once('nope', '2026-10-07T01:00:00Z'), once('2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z')),
    ).toBe(true);
  });

  it('둘 다 끝없이 반복할 때 첫 회차가 겹치면 어느 쪽을 앞에 두어도 겹친다', () => {
    const a = { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T00:01:00Z', repeatHours: 0.2, repeatUntil: null };
    const b = { startsAt: '2026-10-06T23:58:30Z', endsAt: '2026-10-07T00:00:30Z', repeatHours: 0.3, repeatUntil: null };

    expect(overlapsWithRepeats(a, b)).toBe(true);
    expect(overlapsWithRepeats(b, a)).toBe(true);
  });

  it('둘 다 끝없이 반복할 때 경계가 맞닿기만 하면 겹치지 않는다', () => {
    const a = { startsAt: '2026-10-07T00:00:00Z', endsAt: '2026-10-07T00:01:00Z', repeatHours: 0.2, repeatUntil: null };
    const b = { startsAt: '2026-10-07T00:01:00Z', endsAt: '2026-10-07T00:02:00Z', repeatHours: 0.3, repeatUntil: null };

    expect(overlapsWithRepeats(a, b)).toBe(false);
    expect(overlapsWithRepeats(b, a)).toBe(false);
  });
});
