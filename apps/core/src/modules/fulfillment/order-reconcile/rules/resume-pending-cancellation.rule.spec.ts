import { CancelBlockerCode } from '../../services/cancel-readiness';
import { CancellationResumeReadiness } from '../../services/shipment-planning.service';
import { cancellationReadinessFingerprint } from './resume-pending-cancellation.rule';

describe('cancellationReadinessFingerprint', () => {
  const base: CancellationResumeReadiness = {
    operationId: 'op',
    shipmentId: 'box',
    blockers: ['WAYBILL_NOT_VOIDABLE', 'SOURCE_STATE_CHANGED'],
  };

  it('막힘 순서에 흔들리지 않는다', () => {
    expect(cancellationReadinessFingerprint({ ...base, blockers: [...base.blockers].reverse() })).toBe(
      cancellationReadinessFingerprint(base),
    );
  });

  it('막힘이 하나 풀리면(송장이 registered 로 굳음) 바뀐다 — 포기 뒤 원인이 풀리면 다시 시도한다', () => {
    expect(cancellationReadinessFingerprint({ ...base, blockers: ['SOURCE_STATE_CHANGED'] })).not.toBe(
      cancellationReadinessFingerprint(base),
    );
  });

  it('막힘이 없으면 오퍼레이션만 남는다 — 다른 오퍼레이션과 갈린다', () => {
    expect(cancellationReadinessFingerprint({ ...base, blockers: [] })).toBe('op|');
    expect(cancellationReadinessFingerprint({ ...base, operationId: 'op2', blockers: [] })).not.toBe('op|');
  });

  it('부르는 쪽의 막힘 배열을 바꾸지 않는다', () => {
    const blockers: CancelBlockerCode[] = ['WAYBILL_NOT_VOIDABLE', 'INSPECTED_QTY'];
    cancellationReadinessFingerprint({ ...base, blockers });
    expect(blockers).toEqual(['WAYBILL_NOT_VOIDABLE', 'INSPECTED_QTY']);
  });
});
