/**
 * 기준시각 파싱 회귀 테스트 (DB 불필요).
 * 여기서 9시간이 틀리면 하루치 예약을 잘못 지우거나 남긴다.
 */
import { channelAdapterUrl, decideApplyGuard, parseCutoff } from './clear-reservations';

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

describe('--apply 가드 (#1247)', () => {
  const T = new Date('2026-11-20T00:00:00Z');

  it('run.sh 의 URL 에서 DB 이름만 channel_adapter 로 바꾼다', () => {
    expect(channelAdapterUrl('postgresql://u%40x:p%2Fw@10.0.0.5:5432/medusa?sslmode=require')).toBe(
      'postgresql://u%40x:p%2Fw@10.0.0.5:5432/channel_adapter?sslmode=require',
    );
  });

  it('T 가 있으면 --apply 를 exit 1 사유와 함께 막는다', () => {
    const g = decideApplyGuard({ apply: true, cutoverAt: T, readFailed: null });
    expect(g).toEqual({ allow: false, message: 'T 가 설정돼 있다 — 이 스크립트는 더 돌리지 않는다(#1247)' });
  });

  it('T 를 못 읽으면 --apply 를 거부한다(fail-closed)', () => {
    const g = decideApplyGuard({ apply: true, cutoverAt: null, readFailed: 'ECONNREFUSED' });
    expect(g.allow).toBe(false);
  });

  it('T 가 비어 있으면 --apply 를 허용한다', () => {
    expect(decideApplyGuard({ apply: true, cutoverAt: null, readFailed: null })).toEqual({ allow: true });
  });

  it('dry-run 은 T 가 있어도, 접속이 실패해도 막지 않는다', () => {
    expect(decideApplyGuard({ apply: false, cutoverAt: T, readFailed: null }).allow).toBe(true);
    expect(decideApplyGuard({ apply: false, cutoverAt: null, readFailed: 'x' }).allow).toBe(true);
  });
});
