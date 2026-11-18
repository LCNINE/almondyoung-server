import { type ExtractResult, chunkFileIds, mergeExtractResults, normalizeRegions } from './draft';

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
    expect(chunkFileIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
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

describe('normalizeRegions', () => {
  const size = { width: 1000, height: 500 };

  it('픽셀 좌표를 원본 크기에 대한 비율로 바꾼다', () => {
    expect(normalizeRegions([{ label: 'MG04 문 펄', left: 320, top: 100, width: 80, height: 100 }], size)).toEqual([
      { label: 'MG04 문 펄', x: 0.32, y: 0.2, w: 0.08, h: 0.2 },
    ]);
  });

  it('원본 밖으로 나간 부분은 잘라 낸다', () => {
    expect(normalizeRegions([{ label: '오른쪽 끝', left: 900, top: -50, width: 300, height: 200 }], size)).toEqual([
      { label: '오른쪽 끝', x: 0.9, y: 0, w: 0.1, h: 0.3 },
    ]);
  });

  it('너무 작거나 이름이 빈 영역, 크기를 모르는 이미지는 버린다', () => {
    expect(normalizeRegions([{ label: '점', left: 10, top: 10, width: 20, height: 20 }], size)).toEqual([]);
    expect(normalizeRegions([{ label: ' ', left: 0, top: 0, width: 500, height: 250 }], size)).toEqual([]);
    expect(normalizeRegions([{ label: '전체', left: 0, top: 0, width: 500, height: 250 }], undefined)).toEqual([]);
  });

  it('이미지 하나당 8개까지만 쓴다', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `칩${i}`, left: i * 90, top: 0, width: 80, height: 80 }));

    expect(normalizeRegions(many, size)).toHaveLength(8);
  });
});
