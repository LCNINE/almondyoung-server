import { mergeSkuCandidates } from './sku-candidates';
import { line } from './fixtures.spec-helper';

describe('mergeSkuCandidates', () => {
  it('바코드 후보·AI 후보가 검색 결과보다 위에 오고 id 로 중복 제거한다', () => {
    const l = line({
      barcodeCandidates: [{ skuId: 's1', code: 'C1', name: '바코드후보' }],
      aiCandidates: [
        { skuId: 's2', reason: '이름이 비슷', code: 'C2', name: 'AI후보' },
        { skuId: 's1', reason: '중복', code: 'C1', name: '바코드후보' },
      ],
    });
    const out = mergeSkuCandidates(l, [
      { id: 's2', code: 'C2', name: 'AI후보' },
      { id: 's3', code: 'C3', name: '검색' },
    ]);
    expect(out.map((c) => c.skuId)).toEqual(['s1', 's2', 's3']);
    expect(out[0].hint).toBe('바코드 일치');
    expect(out[1].hint).toBe('이름이 비슷');
    expect(out[2].hint).toBeNull();
  });

  it('AI 후보에 이름이 없으면 검색 결과의 이름을 쓴다', () => {
    const l = line({
      aiCandidates: [{ skuId: 's2', reason: 'r', code: null, name: null }],
    });
    const out = mergeSkuCandidates(l, [
      { id: 's2', code: 'C2', name: '검색이름' },
    ]);
    expect(out[0]).toMatchObject({ skuId: 's2', code: 'C2', name: '검색이름' });
  });

  it('최대 20개로 자른다', () => {
    const results = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`,
      code: `c${i}`,
      name: `n${i}`,
    }));
    expect(mergeSkuCandidates(line(), results)).toHaveLength(20);
  });
});
