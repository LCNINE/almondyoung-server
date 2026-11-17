import { parseArgs } from './set-reservation-cutover';

describe('set-reservation-cutover parseArgs', () => {
  it('Z·오프셋이 있는 ISO 를 받는다', () => {
    expect(parseArgs(['--at', '2026-11-10T00:00:00Z']).at).toEqual(new Date('2026-11-10T00:00:00Z'));
    expect(parseArgs(['--at=2026-11-10T09:00:00+09:00']).at).toEqual(new Date('2026-11-10T00:00:00Z'));
  });
  it.each(['2026-11-10T09:00', '2026-11-10', '2026-11-10T09:00:00', 'nope'])('시간대 없는 %s 는 거절', (v) => {
    expect(() => parseArgs(['--at', v])).toThrow(/시간대|시각/);
  });
  it('--clear 는 null, 둘 다/아무것도 없으면 거절', () => {
    expect(parseArgs(['--clear']).at).toBeNull();
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['--clear', '--at', '2026-11-10T00:00:00Z'])).toThrow();
  });
});
