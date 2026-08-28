import { classifySkuCost, SkuCostCandidate } from './stock-valuation.reader';

function candidate(overrides: Partial<SkuCostCandidate> = {}): SkuCostCandidate {
  return { masterId: 'master-1', name: '단품', supplyPrice: 3000, linkQuantity: 1, ...overrides };
}

describe('classifySkuCost', () => {
  it('연결이 전혀 없으면 unmatched', () => {
    expect(classifySkuCost([])).toEqual({ status: 'unmatched' });
  });

  it('구성수량 0 인 링크만 있으면 unmatched (판정에 못 씀)', () => {
    expect(classifySkuCost([candidate({ linkQuantity: 0 })])).toEqual({ status: 'unmatched' });
  });

  it('단일 상품 + 공급가 있으면 valued, 단위 원가 = 공급가', () => {
    expect(classifySkuCost([candidate()])).toEqual({
      status: 'valued',
      masterId: 'master-1',
      masterName: '단품',
      unitCost: 3000,
    });
  });

  it('세트(구성수량 3)는 공급가를 구성수량으로 안분한다', () => {
    expect(classifySkuCost([candidate({ supplyPrice: 9000, linkQuantity: 3 })])).toEqual({
      status: 'valued',
      masterId: 'master-1',
      masterName: '단품',
      unitCost: 3000,
    });
  });

  it('단품과 세트가 같은 단위 원가로 수렴하면 valued 하나로 판정한다', () => {
    const result = classifySkuCost([
      candidate({ supplyPrice: 3000, linkQuantity: 1 }),
      candidate({ supplyPrice: 9000, linkQuantity: 3 }),
    ]);
    expect(result.status).toBe('valued');
    expect(result.unitCost).toBe(3000);
  });

  it('같은 상품인데 단위 원가가 상충하면 costConflict — 대표값을 임의로 고르지 않는다', () => {
    const result = classifySkuCost([
      candidate({ supplyPrice: 3000, linkQuantity: 1 }),
      candidate({ supplyPrice: 5000, linkQuantity: 3 }),
    ]);
    expect(result).toEqual({ status: 'costConflict', masterId: 'master-1', masterName: '단품' });
  });

  it('공급가가 전부 NULL 이면 costMissing (귀속 상품은 유지)', () => {
    expect(classifySkuCost([candidate({ supplyPrice: null })])).toEqual({
      status: 'costMissing',
      masterId: 'master-1',
      masterName: '단품',
    });
  });

  it('공급가 있는 링크가 하나라도 있으면 NULL 링크는 무시하고 valued', () => {
    const result = classifySkuCost([candidate(), candidate({ supplyPrice: null, linkQuantity: 2 })]);
    expect(result.status).toBe('valued');
    expect(result.unitCost).toBe(3000);
  });

  it('서로 다른 상품 여럿에 연결되면 multiMaster — 금액·귀속 모두 불가', () => {
    const result = classifySkuCost([candidate(), candidate({ masterId: 'master-2', name: '다른 상품' })]);
    expect(result).toEqual({ status: 'multiMaster' });
  });

  it('부동소수 오차 범위의 같은 단위 원가는 상충으로 보지 않는다', () => {
    // 10000/3 을 두 경로로 계산해도 소수 4자리 절사 후 같아야 한다
    const result = classifySkuCost([
      candidate({ supplyPrice: 10000, linkQuantity: 3 }),
      candidate({ supplyPrice: 20000, linkQuantity: 6 }),
    ]);
    expect(result.status).toBe('valued');
  });
});
