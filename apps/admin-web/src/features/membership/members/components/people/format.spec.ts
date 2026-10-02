import {
  arrearsCauseLabel,
  arrearsCauseShort,
  daysUntilDate,
  percent,
  periodLabel,
} from './format';

describe('periodLabel', () => {
  it('한 달을 온전히 덮으면 「N월분」', () => {
    expect(periodLabel('2026-08-01', '2026-08-31')).toBe('2026년 8월분');
    expect(periodLabel('2026-02-01', '2026-02-28')).toBe('2026년 2월분');
  });

  it('달 중간에서 시작하거나 끝나면 날짜 범위', () => {
    expect(periodLabel('2026-08-05', '2026-09-04')).toBe('8/5 ~ 9/4');
    expect(periodLabel('2026-08-01', '2026-08-30')).toBe('8/1 ~ 8/30');
  });

  it('기간을 모르면 null — 0 이나 빈 문자열로 뭉개지 않는다', () => {
    expect(periodLabel(null, '2026-08-31')).toBeNull();
    expect(periodLabel('2026-08-01', null)).toBeNull();
  });
});

describe('미납 사유 문구', () => {
  it('출금 소진과 계좌 심사 거절을 다른 말로 쓴다', () => {
    expect(arrearsCauseLabel('UNCOLLECTIBLE', 'Q999')).toBe(
      '자동이체 출금이 끝내 실패'
    );
    expect(arrearsCauseLabel('MANDATE_REJECTED', 'MANDATE_TIMEOUT')).toBe(
      '계좌 심사가 기한 안에 끝나지 않음'
    );
    expect(arrearsCauseLabel('MANDATE_REJECTED', 'Q201')).toMatch(
      /^계좌 심사 거절 — /
    );
    expect(arrearsCauseLabel('MANDATE_REJECTED', null)).toBe('계좌 심사 거절');
  });

  it('목록용 짧은 사유는 중복을 합친다', () => {
    expect(
      arrearsCauseShort(['UNCOLLECTIBLE', 'UNCOLLECTIBLE', 'MANDATE_REJECTED'])
    ).toBe('출금 실패 · 계좌 심사 거절');
    expect(arrearsCauseShort([])).toBe('-');
  });
});

describe('숫자 보조', () => {
  it('분모가 0 이면 비율을 지어내지 않는다', () => {
    expect(percent(1, 0)).toBe('-');
    expect(percent(1, 3)).toBe('33%');
  });

  it('남은 날은 한국 날짜 기준이다', () => {
    // 한국 시간 9/28 00:30 = UTC 9/27 15:30
    const now = new Date('2026-09-27T15:30:00Z');
    expect(daysUntilDate('2026-09-28', now)).toBe(0);
    expect(daysUntilDate('2026-10-03', now)).toBe(5);
  });
});
