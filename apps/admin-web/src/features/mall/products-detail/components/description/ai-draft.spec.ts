import {
  type ExtractResult,
  chunkFileIds,
  mergeExtractResults,
} from './ai-draft';

function result(over: Partial<ExtractResult> = {}): ExtractResult {
  return {
    images: [],
    facts: { brand: '', capacity: '', origin: '', composition: '', expiry: '' },
    features: [],
    usageSteps: [],
    cautions: [],
    ...over,
  };
}

describe('chunkFileIds', () => {
  it('나누어떨어지지 않아도 마지막 청크에 나머지를 담는다', () => {
    expect(chunkFileIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('청크 크기 이하면 한 덩어리다', () => {
    expect(chunkFileIds(['a', 'b'], 8)).toEqual([['a', 'b']]);
  });

  it('빈 목록이면 청크도 없다 — 호출 0회', () => {
    expect(chunkFileIds([], 8)).toEqual([]);
  });
});

describe('mergeExtractResults', () => {
  it('이미지는 청크 순서대로 이어붙인다', () => {
    const merged = mergeExtractResults([
      result({ images: [{ fileId: 'f1', kind: '제품컷', content: 'a' }] }),
      result({ images: [{ fileId: 'f2', kind: '스펙표', content: 'b' }] }),
    ]);

    expect(merged.images.map((image) => image.fileId)).toEqual(['f1', 'f2']);
  });

  // 스펙표가 뒤쪽 청크에 있으면 앞 청크의 빈 값이 결과를 덮어선 안 된다.
  it('앞 청크가 비운 항목을 뒤 청크가 채운다', () => {
    const merged = mergeExtractResults([
      result({
        facts: {
          brand: 'Permablend',
          capacity: '',
          origin: '',
          composition: '',
          expiry: '',
        },
      }),
      result({
        facts: {
          brand: '',
          capacity: '15ml',
          origin: '미국',
          composition: '',
          expiry: '',
        },
      }),
    ]);

    expect(merged.facts.brand).toBe('Permablend');
    expect(merged.facts.capacity).toBe('15ml');
    expect(merged.facts.origin).toBe('미국');
  });

  it('같은 항목이 청크마다 다르면 먼저 채운 값을 지킨다', () => {
    const merged = mergeExtractResults([
      result({
        facts: {
          brand: 'Permablend',
          capacity: '',
          origin: '',
          composition: '',
          expiry: '',
        },
      }),
      result({
        facts: {
          brand: 'Tina Davies',
          capacity: '',
          origin: '',
          composition: '',
          expiry: '',
        },
      }),
    ]);

    expect(merged.facts.brand).toBe('Permablend');
  });

  it('목록 항목은 모두 모은다', () => {
    const merged = mergeExtractResults([
      result({ features: ['발색이 선명함'], cautions: ['개봉 후 냉장'] }),
      result({ features: ['점도가 낮음'], usageSteps: ['잘 흔든다'] }),
    ]);

    expect(merged.features).toEqual(['발색이 선명함', '점도가 낮음']);
    expect(merged.cautions).toEqual(['개봉 후 냉장']);
    expect(merged.usageSteps).toEqual(['잘 흔든다']);
  });
});
