import { ConflictError } from '@app/shared';
import { assertLabelAvailable } from './waybill-label.manager';

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
