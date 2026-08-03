/**
 * 기준시각 파싱 회귀 테스트 (DB 불필요).
 * 여기서 9시간이 틀리면 하루치 예약을 잘못 지우거나 남긴다.
 */
import { parseCutoff } from './clear-reservations';

describe('parseCutoff — CSV 파일명(KST) → UTC', () => {
  it('셀메이트 파일명에서 스냅샷 시각을 읽는다', () => {
    expect(parseCutoff('/Users/x/Downloads/stk_stockList_20260729_102241.csv').toISOString()).toBe(
      '2026-07-29T01:22:41.000Z', // 10:22:41 KST = 01:22:41 UTC
    );
  });

  it('--before 로 준 KST 문자열도 같은 규칙으로 해석한다', () => {
    expect(parseCutoff('2026-07-29 10:22:41').toISOString()).toBe('2026-07-29T01:22:41.000Z');
    expect(parseCutoff('2026-07-29T10:22').toISOString()).toBe('2026-07-29T01:22:00.000Z');
  });

  it('시각을 못 읽으면 조용히 now() 로 떨어지지 않고 중단한다', () => {
    expect(() => parseCutoff('stock.csv')).toThrow(/기준시각/);
    expect(() => parseCutoff('어제')).toThrow(/기준시각/);
  });
});
