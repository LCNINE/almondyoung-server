import { planLocationMaster } from './location-master-plan';

const rows = (...codes: string[]) => codes.map((positionCode) => ({ positionCode, skuCount: 1 }));

describe('planLocationMaster', () => {
  it('데이터에 나온 랙만 만들고, 칸 끝은 가장 큰 숫자 칸이다', () => {
    const plan = planLocationMaster(rows('A-01-01', 'A-01-07', 'A-03-02'));
    expect(plan.columns).toEqual(['A']);
    expect(plan.racks).toEqual([
      { column: 'A', rackNumber: 1, binEnd: 7, customBins: [] },
      { column: 'A', rackNumber: 3, binEnd: 2, customBins: [] },
    ]);
    expect(plan.missingRackNumbers).toEqual([{ column: 'A', rackNumbers: [2] }]);
  });

  it('100 이상 칸도 번호로 센다', () => {
    expect(planLocationMaster(rows('Z-01-05', 'Z-01-105')).racks).toEqual([
      { column: 'Z', rackNumber: 1, binEnd: 105, customBins: [] },
    ]);
  });

  it('커스텀 칸은 그 랙에 더한다', () => {
    const plan = planLocationMaster(rows('M-07-03', 'M-07-꼭대기'));
    expect(plan.racks).toEqual([{ column: 'M', rackNumber: 7, binEnd: 3, customBins: ['꼭대기'] }]);
    expect(plan.customBins).toEqual([{ raw: 'M-07-꼭대기', code: 'M-07-꼭대기', skuCount: 1 }]);
  });

  it('커스텀 칸만 있는 랙은 binEnd 가 null 이다', () => {
    expect(planLocationMaster(rows('G-04-바닥')).racks).toEqual([
      { column: 'G', rackNumber: 4, binEnd: null, customBins: ['바닥'] },
    ]);
  });

  it('고쳐 읽은 코드는 바른 코드와 같은 랙으로 모이고 원문별로 보고한다', () => {
    const plan = planLocationMaster([
      { positionCode: 'CC-4-1', skuCount: 2 },
      { positionCode: 'CC-04-01', skuCount: 1 },
    ]);
    expect(plan.racks).toEqual([{ column: 'CC', rackNumber: 4, binEnd: 1, customBins: [] }]);
    expect(plan.fixed).toEqual([{ raw: 'CC-4-1', code: 'CC-04-01', rule: 'zero-pad', skuCount: 2 }]);
  });

  it('예외는 만들지 않고 보고만 한다', () => {
    const plan = planLocationMaster([{ positionCode: '외부창고', skuCount: 3 }]);
    expect(plan.columns).toEqual([]);
    expect(plan.racks).toEqual([]);
    expect(plan.exceptions).toEqual([{ raw: '외부창고', skuCount: 3 }]);
  });
});
