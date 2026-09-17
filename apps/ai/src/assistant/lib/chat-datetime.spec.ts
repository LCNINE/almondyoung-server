import { buildDateTimeContext } from './chat-datetime';

describe('buildDateTimeContext', () => {
  it('UTC 자정 직후에도 KST 날짜를 준다', () => {
    // 2026-09-16T00:30:00Z = KST 09:30. UTC 를 그대로 쓰면 날짜가 하루 어긋나는 구간.
    const block = buildDateTimeContext(new Date('2026-09-16T00:30:00Z'));

    expect(block).toContain('2026-09-16');
    expect(block).toContain('09:30 KST');
    expect(block).toContain('+09:00');
  });

  it('UTC 로는 전날인 시각도 KST 기준 날짜로 옮긴다', () => {
    // 2026-09-15T20:00:00Z = KST 2026-09-16 05:00
    const block = buildDateTimeContext(new Date('2026-09-15T20:00:00Z'));

    expect(block).toContain('2026-09-16');
    expect(block).toContain('05:00 KST');
  });

  it('자정을 24:00 이 아니라 00:00 으로 쓴다', () => {
    // 2026-09-15T15:00:00Z = KST 2026-09-16 00:00
    expect(buildDateTimeContext(new Date('2026-09-15T15:00:00Z'))).toContain('00:00 KST');
  });
});
