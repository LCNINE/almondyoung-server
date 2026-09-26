import { ConflictError } from '@app/shared';
import { assertContextMatchesWaybill, assertLabelAvailable } from './waybill-label.manager';

const base = { id: 'w1', source: 'carrier' as const, carrier: 'HANJIN' as const, labelData: { hub_cod: 'NX' } };

describe('assertLabelAvailable', () => {
  it('한진이 발급한 운송장은 통과', () => {
    expect(() => assertLabelAvailable(base)).not.toThrow();
  });

  it('수기 등록 운송장은 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, source: 'manual', labelData: null });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('한진이 아닌 캐리어는 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, carrier: 'CJ' });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('캐리어 발급인데 labelData 가 없으면 500(불변식 위반) — 도메인 에러가 아니다', () => {
    const run = () => assertLabelAvailable({ ...base, labelData: null });
    expect(run).toThrow(/labelData/);
    expect(run).not.toThrow(ConflictError);
  });
});

// assertDispatchable 과 loadIssueContext 사이(READ COMMITTED 별개 statement)에 수하인 정정이 커밋되면,
// 해시 검사(assertDispatchable)는 통과했는데 실제 조립은 새 주소를 쓰는 레이스가 생긴다(#913 최종리뷰).
// render() 는 loadIssueContext 직후 이 순수 함수로 재확인한다.
describe('assertContextMatchesWaybill', () => {
  const waybill = { id: 'w1', manifestVersion: 3, recipientHash: 'hash-a' };
  const ctx = { manifestVersion: 3, recipientSnapshot: { any: 'thing' } };
  const hashOf = () => 'hash-a';

  it('매니페스트 버전·수하인 해시가 모두 일치하면 통과', () => {
    expect(() => assertContextMatchesWaybill(waybill, ctx, hashOf)).not.toThrow();
  });

  it('가드 이후 매니페스트 버전이 바뀌면 409 WAYBILL_STALE', () => {
    const run = () => assertContextMatchesWaybill(waybill, { ...ctx, manifestVersion: 4 }, hashOf);
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_STALE/);
  });

  it('가드 이후 수하인이 바뀌면(해시 불일치) 409 WAYBILL_STALE', () => {
    const run = () => assertContextMatchesWaybill(waybill, ctx, () => 'hash-b');
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_STALE/);
  });
});
