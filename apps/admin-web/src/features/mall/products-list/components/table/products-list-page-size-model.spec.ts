import {
  parsePageSize,
  hasActiveFilter,
  canSelectAll,
  filterSignature,
  selectionStaleness,
  DEFAULT_PAGE_SIZE,
} from './products-list-page-size-model';

describe('parsePageSize', () => {
  it.each([
    ['20', 20],
    ['50', 50],
    ['100', 100],
  ])('허용값 %s 를 그대로 쓴다', (raw, expected) => {
    expect(parsePageSize(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'abc', '0', '-10', '30', '200', '999', '20.5'])(
    '허용값이 아니면 기본값으로 떨어진다: %s',
    (raw) => {
      expect(parsePageSize(raw as string | null | undefined)).toBe(
        DEFAULT_PAGE_SIZE
      );
    }
  );
});

describe('hasActiveFilter', () => {
  const params = (init: Record<string, string>) => new URLSearchParams(init);

  it.each([
    'q',
    'brand',
    'categoryId',
    'supplierId',
    'createdBy',
    'status',
    'stock',
    'createdAt',
  ])('%s 가 있으면 필터로 친다', (key) => {
    expect(hasActiveFilter(params({ [key]: 'x' }))).toBe(true);
  });

  it.each(['page', 'size', 'sort', 'order', 'datePreset'])(
    '%s 는 필터로 치지 않는다',
    (key) => {
      expect(hasActiveFilter(params({ [key]: 'x' }))).toBe(false);
    }
  );

  it('아무것도 없으면 false', () => {
    expect(hasActiveFilter(params({}))).toBe(false);
  });

  it('빈 문자열 값은 필터가 아니다', () => {
    expect(hasActiveFilter(params({ q: '' }))).toBe(false);
  });
});

describe('canSelectAll', () => {
  it('필터가 없으면 막고 이유를 준다', () => {
    expect(canSelectAll({ hasFilter: false, total: 10 })).toEqual({
      ok: false,
      reason: '필터를 먼저 걸어주세요.',
    });
  });

  it('결과가 0건이면 막는다', () => {
    expect(canSelectAll({ hasFilter: true, total: 0 })).toEqual({
      ok: false,
      reason: '선택할 상품이 없습니다.',
    });
  });

  it('결과가 있으면 허용한다', () => {
    expect(canSelectAll({ hasFilter: true, total: 5000 })).toEqual({
      ok: true,
    });
  });

  // 예전에는 여기서 막았다. 그러나 total 은 목록 쿼리의 수라 카테고리 팬아웃으로 부풀어
  // 있어서, 실제 distinct 4,000건인 카테고리가 6,000으로 보이면 버튼이 영구히 잠겼다.
  // 클라이언트의 숫자는 믿을 게 못 되고 서버만 중복을 제거한 수를 안다 — 그래서 열어 두고
  // 서버의 400('선택 가능한 범위를 넘었습니다…')을 토스트로 받는다.
  it('상한을 넘어 보여도 막지 않는다 — 상한 판정은 서버 몫이다', () => {
    expect(canSelectAll({ hasFilter: true, total: 5001 })).toEqual({
      ok: true,
    });
    expect(canSelectAll({ hasFilter: true, total: 1_000_000 })).toEqual({
      ok: true,
    });
  });

  it('필터가 없으면서 0건이면 필터 사유를 우선한다', () => {
    expect(canSelectAll({ hasFilter: false, total: 0 }).reason).toBe(
      '필터를 먼저 걸어주세요.'
    );
  });
});

describe('filterSignature', () => {
  const params = (init: Record<string, string>) => new URLSearchParams(init);

  it('필터가 없으면 빈 문자열', () => {
    expect(filterSignature(params({}))).toBe('');
  });

  it('필터 값을 key=value 로 이어붙인다', () => {
    expect(filterSignature(params({ brand: 'nike' }))).toBe('brand=nike');
  });

  it.each(['page', 'size', 'sort', 'order', 'datePreset'])(
    '%s 는 서명에 넣지 않는다',
    (key) => {
      expect(filterSignature(params({ [key]: 'x' }))).toBe('');
    }
  );

  it('보기 설정만 다르면 서명이 같다 — 페이지를 넘겨도 필터는 그대로다', () => {
    const a = filterSignature(params({ brand: 'nike', page: '1', size: '20' }));
    const b = filterSignature(
      params({
        brand: 'nike',
        page: '7',
        size: '100',
        sort: 'name',
        order: 'asc',
      })
    );
    expect(a).toBe(b);
  });

  it('키 순서가 달라도 서명이 같다 — FILTER_KEYS 순서로 정규화된다', () => {
    const a = filterSignature(new URLSearchParams('brand=nike&q=shoe'));
    const b = filterSignature(new URLSearchParams('q=shoe&brand=nike'));
    expect(a).toBe(b);
  });

  it('값이 다르면 서명이 다르다', () => {
    expect(filterSignature(params({ brand: 'nike' }))).not.toBe(
      filterSignature(params({ brand: 'adidas' }))
    );
  });

  it('필터가 하나 더 붙으면 서명이 다르다', () => {
    expect(filterSignature(params({ brand: 'nike' }))).not.toBe(
      filterSignature(params({ brand: 'nike', status: 'active' }))
    );
  });

  it('빈 문자열 값은 없는 것으로 친다', () => {
    expect(filterSignature(params({ brand: '' }))).toBe('');
  });
});

describe('selectionStaleness', () => {
  const MESSAGE = '지금 화면의 필터와 다른 조건에서 고른 항목이 섞여 있습니다.';

  it('선택이 0건이면 경고하지 않는다', () => {
    expect(
      selectionStaleness({
        signatures: ['brand=nike'],
        currentSignature: 'brand=adidas',
        selectedCount: 0,
      })
    ).toEqual({ stale: false });
  });

  it('서명이 하나뿐이고 현재와 같으면 경고하지 않는다', () => {
    expect(
      selectionStaleness({
        signatures: ['brand=nike'],
        currentSignature: 'brand=nike',
        selectedCount: 30,
      })
    ).toEqual({ stale: false });
  });

  it('서명이 하나뿐이지만 현재와 다르면 경고한다', () => {
    expect(
      selectionStaleness({
        signatures: ['brand=nike'],
        currentSignature: 'brand=adidas',
        selectedCount: 30,
      })
    ).toEqual({ stale: true, message: MESSAGE });
  });

  it('서명이 둘 이상이면 현재 서명이 그 안에 있어도 경고한다', () => {
    expect(
      selectionStaleness({
        signatures: ['brand=nike', 'brand=adidas'],
        currentSignature: 'brand=nike',
        selectedCount: 30,
      })
    ).toEqual({ stale: true, message: MESSAGE });
  });

  it('필터 없음(빈 서명)끼리는 같은 조건이다', () => {
    expect(
      selectionStaleness({
        signatures: [''],
        currentSignature: '',
        selectedCount: 5,
      })
    ).toEqual({ stale: false });
  });

  it('필터를 지워 빈 서명이 되면 경고한다', () => {
    expect(
      selectionStaleness({
        signatures: ['brand=nike'],
        currentSignature: '',
        selectedCount: 5,
      })
    ).toEqual({
      stale: true,
      message: MESSAGE,
    });
  });

  it('page/size/sort/order 만 바뀐 것은 stale 이 아니다 — 서명이 같아지기 때문이다', () => {
    const before = new URLSearchParams('brand=nike&page=1&size=20');
    const after = new URLSearchParams(
      'brand=nike&page=3&size=100&sort=name&order=asc'
    );
    expect(
      selectionStaleness({
        signatures: [filterSignature(before)],
        currentSignature: filterSignature(after),
        selectedCount: 300,
      })
    ).toEqual({ stale: false });
  });

  it('기록된 서명이 없으면(=근거 없음) 경고한다', () => {
    expect(
      selectionStaleness({
        signatures: [],
        currentSignature: 'brand=nike',
        selectedCount: 1,
      })
    ).toEqual({
      stale: true,
      message: MESSAGE,
    });
  });
});
