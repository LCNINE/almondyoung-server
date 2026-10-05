import { toQuarantineSummary } from './order-collection-failures.shape';

describe('toQuarantineSummary', () => {
  it('인터셉터가 벗긴 몸통과 envelope 둘 다 읽는다', () => {
    const data = {
      quarantined: 3,
      oldestCreatedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(toQuarantineSummary(data)).toEqual(data);
    expect(toQuarantineSummary({ success: true, data })).toEqual(data);
  });
  it('깨진 몸통은 0', () => {
    expect(toQuarantineSummary('x')).toEqual({
      quarantined: 0,
      oldestCreatedAt: null,
    });
  });
});
