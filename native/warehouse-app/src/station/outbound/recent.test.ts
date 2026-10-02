import { describe, expect, it } from 'vitest';
import { RECENT_LIMIT, clockOf, pushRecent, type RecentEntry } from './recent';

describe('최근 스캔', () => {
  it('새것이 위, 8줄까지, id 는 겹치지 않는다', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) list = pushRecent(list, { at: i, kind: 'scan', text: `#${i}` });
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].text).toBe('#9');
    expect(list.at(-1)?.text).toBe('#2');
    expect(new Set(list.map((e) => e.id)).size).toBe(RECENT_LIMIT);
  });

  it('기기 시계 HH:MM:SS', () => {
    expect(clockOf(new Date(2026, 9, 2, 14, 2, 5).getTime())).toBe('14:02:05');
  });
});
