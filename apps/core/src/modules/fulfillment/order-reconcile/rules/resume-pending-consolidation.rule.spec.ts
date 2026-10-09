import { readinessFingerprint } from './resume-pending-consolidation.rule';

describe('readinessFingerprint', () => {
  const base = {
    operationId: 'op',
    sources: [
      {
        shipmentId: 'b',
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
        manifestVersion: 1,
        reservationVersion: 2,
      },
      {
        shipmentId: 'a',
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
        manifestVersion: 1,
        reservationVersion: 1,
      },
    ],
    blockers: [{ shipmentId: 'a', codes: ['ACTIVE_WORK_ITEM', 'ACTIVE_INVOICE'] }],
  };

  it('원본·막힘 순서에 흔들리지 않는다', () => {
    const shuffled = {
      ...base,
      sources: [...base.sources].reverse(),
      blockers: [{ shipmentId: 'a', codes: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'] }],
    };
    expect(readinessFingerprint(shuffled)).toBe(readinessFingerprint(base));
  });

  it('막힘이 하나 풀리면(송장 취소) 바뀐다 — 포기 뒤 운영자가 원인을 고치면 다시 시도한다', () => {
    expect(readinessFingerprint({ ...base, blockers: [{ shipmentId: 'a', codes: ['ACTIVE_WORK_ITEM'] }] })).not.toBe(
      readinessFingerprint(base),
    );
  });

  it('원본의 버전이 바뀌면 바뀐다', () => {
    const bumped = { ...base, sources: [{ ...base.sources[0], reservationVersion: 3 }, base.sources[1]] };
    expect(readinessFingerprint(bumped)).not.toBe(readinessFingerprint(base));
  });
});
