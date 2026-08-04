import {
  buildCategoryPathIndex,
  checkOptionStructure,
  classifyImageSource,
  extractDirectiveImageKeys,
  resolveCategories,
  resolveImageRefs,
} from './bulk-session.structure';

describe('checkOptionStructure', () => {
  const base = {
    product: {},
    options: [
      { optionKey: 'og1', optionValueKey: 'ov1', optionName: '색상', optionValueName: '빨강' },
      { optionKey: 'og1', optionValueKey: 'ov2', optionName: '색상', optionValueName: '파랑' },
    ],
    variants: [{ combination: 'ov1' }, { combination: 'ov2' }],
    categories: [],
    constraint: null,
    images: {},
  };

  it('표시명만 바꾸면 통과한다 (optionValueId 가 그대로라 매칭이 안전하다)', () => {
    const uploaded = {
      ...base,
      options: base.options.map((o) => ({ ...o, optionValueName: `${o.optionValueName}색` })),
    };
    expect(checkOptionStructure(uploaded, base)).toEqual([]);
  });

  it('옵션값을 추가하면 행 오류다', () => {
    const uploaded = {
      ...base,
      options: [...base.options, { optionKey: 'og1', optionValueKey: 'ov3', optionValueName: '초록' }],
    };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션값');
  });

  it('옵션값을 지우면 행 오류다', () => {
    const uploaded = { ...base, options: [base.options[0]] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션값');
  });

  it('옵션 축을 추가하면 행 오류다', () => {
    const uploaded = {
      ...base,
      options: [...base.options, { optionKey: 'og2', optionValueKey: 'ov9', optionValueName: 'S' }],
    };
    expect(checkOptionStructure(uploaded, base).length).toBeGreaterThan(0);
  });

  it('조합 행이 빠지면 행 오류다', () => {
    const uploaded = { ...base, variants: [base.variants[0]] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('조합');
  });

  it('없던 조합을 만들면 행 오류다', () => {
    const uploaded = { ...base, variants: [...base.variants, { combination: 'ov1+ov2' }] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('조합');
  });

  it('같은 옵션키에 서로 다른 옵션명을 적으면 행 오류다', () => {
    const uploaded = { ...base, options: [base.options[0], { ...base.options[1], optionName: '컬러' }] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션명');
  });
});

describe('classifyImageSource', () => {
  it('UUID 는 fileId 다', () => {
    expect(classifyImageSource('0198f0a0-0000-7000-8000-000000000000')).toEqual({ kind: 'file_id' });
  });

  it('파일명은 file_name 이다', () => {
    expect(classifyImageSource('사진 1.JPG')).toEqual({ kind: 'file_name' });
  });

  it('http URL 은 오류다 — URL 소싱은 지원하지 않는다', () => {
    expect(classifyImageSource('https://example.com/a.jpg')).toEqual({
      error: 'URL 은 지원하지 않습니다. 파일을 직접 올리거나 파일명을 적어주세요.',
    });
  });
});

// product-import-image.directive.spec.ts 에서 이식했다 — 6단계가 그 파일을 지웠다.
//
// `resolveImageRefs` 의 `addRef` 는 (usage, imageKey) 로 자체 dedup 을 하기 때문에, 이 함수
// 자체의 dedup(같은 키 반복 시 한 번만 반환)이 깨져도 `resolveImageRefs` 를 통해서는 드러나지
// 않는다. 그래서 여기서는 `resolveImageRefs` 를 거치지 않고 직접 부른다.
describe('extractDirectiveImageKeys', () => {
  it('본문의 imageKey 를 등장 순서로 뽑는다', () => {
    const md = '앞\n::product-image{imageKey="IMG-2" alt="상세"}\n뒤\n::product-image{imageKey="IMG-3"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2', 'IMG-3']);
  });

  it('같은 키가 여러 번 나와도 한 번만 돌려준다', () => {
    const md = '::product-image{imageKey="IMG-2"}\n::product-image{imageKey="IMG-2"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2']);
  });

  it('속성 순서가 달라도 찾는다', () => {
    expect(extractDirectiveImageKeys('::product-image{alt="a" imageKey="IMG-9"}')).toEqual(['IMG-9']);
  });

  it('imageKey 가 없는 디렉티브(이미 fileId 인 것)는 무시한다', () => {
    const md = '::product-image{fileId="0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" alt="x"}';
    expect(extractDirectiveImageKeys(md)).toEqual([]);
  });

  it('본문이 없으면 빈 배열', () => {
    expect(extractDirectiveImageKeys(undefined)).toEqual([]);
    expect(extractDirectiveImageKeys('')).toEqual([]);
  });

  it('다른 디렉티브는 건드리지 않는다', () => {
    expect(extractDirectiveImageKeys('::note{imageKey="IMG-1"}')).toEqual([]);
  });
});

describe('resolveImageRefs', () => {
  const sheet = new Map([
    ['IMG-1', { rowNumber: 1, sourceValue: 'a.jpg' }],
    ['IMG-2', { rowNumber: 2, sourceValue: 'b.jpg' }],
  ]);
  const imageRow = (product: Record<string, string>) => ({
    rowNumber: 1,
    rowKey: 'P-1',
    kind: 'create' as const,
    bundle: { product, options: [], variants: [], categories: [], constraint: null },
    errors: [],
  });

  it('대표·부가는 main, 본문 디렉티브는 description 으로 추론한다', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', description: '앞::product-image{imageKey="IMG-2"}뒤' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-2', usage: 'description' },
    ]);
  });

  it('한 키가 대표와 본문에 함께 쓰이면 ref 가 둘 생긴다 (컨텍스트별 MIME·크기 제약이 다르다)', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', description: '::product-image{imageKey="IMG-1"}' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-1', usage: 'description' },
    ]);
  });

  it('같은 (키, 용도) 를 두 번 가리켜도 ref 는 하나다', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', additionalImageKeys: 'IMG-1|IMG-2' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-2', usage: 'main' },
    ]);
  });

  it('이미지 시트에 없는 키를 참조하면 행 오류다', () => {
    const { errors } = resolveImageRefs(imageRow({ thumbnailImageKey: 'IMG-9' }), sheet);
    expect(errors[0].message).toContain('IMG-9');
  });

  it('본문에 이미 fileId 로 박힌 디렉티브는 참조로 세지 않는다 (이미 해석된 값이다)', () => {
    const { refs, errors } = resolveImageRefs(
      imageRow({ description: '::product-image{fileId="0198f0a0-0000-7000-8000-000000000000"}' }),
      sheet,
    );
    expect(refs).toEqual([]);
    expect(errors).toEqual([]);
  });

  // ─── 프리필 참조 관용 (수정 행 전용) ───
  //
  // 파서는 '이미지' 시트가 통째로 없는 파일을 의도적으로 허용한다(필수는 '상품' 시트뿐).
  // 그런데 프리필된 `대표이미지키=IMG-1` 이 그대로인 수정 행까지 "시트에 없는 키"로 잡히면,
  // 이미지를 건드리지도 않은 행이 전부 invalid 이 된다 — 관용의 정반대다.
  describe('안 건드린 프리필 참조', () => {
    const empty = new Map<string, { rowNumber: number; sourceValue: string }>();
    const updateRow = (product: Record<string, string>) => ({ ...imageRow(product), kind: 'update' as const });
    const prefilled = (unchanged: Array<'thumbnailImageKey' | 'additionalImageKeys' | 'description'>) => ({
      keys: new Set(['IMG-1', 'IMG-2']),
      unchanged: new Set(unchanged),
    });

    it('이미지 시트가 통째로 없어도, 값이 그대로인 프리필 참조는 오류가 아니다', () => {
      const { refs, errors } = resolveImageRefs(
        updateRow({ thumbnailImageKey: 'IMG-1' }),
        empty,
        prefilled(['thumbnailImageKey', 'additionalImageKeys', 'description']),
      );

      expect(errors).toEqual([]);
      // 3단계가 붙일 파일이 없다 — 그 이미지는 4단계의 포크가 이미 들고 있다.
      expect(refs).toEqual([]);
    });

    it('**바뀐** 칸의 참조는 여전히 시트에서 해석돼야 한다 — 아니면 진짜 오타다', () => {
      const { errors } = resolveImageRefs(
        updateRow({ thumbnailImageKey: 'IMG-1' }),
        empty,
        // 대표이미지키가 변경분에 있다 = unchanged 에 없다.
        prefilled(['additionalImageKeys', 'description']),
      );

      expect(errors[0].message).toContain('IMG-1');
    });

    it('스냅샷에도 없는 키는 안 건드렸어도 오류다 (해석할 근거가 어디에도 없다)', () => {
      const { errors } = resolveImageRefs(
        updateRow({ thumbnailImageKey: 'IMG-9' }),
        empty,
        prefilled(['thumbnailImageKey', 'additionalImageKeys', 'description']),
      );

      expect(errors[0].message).toContain('IMG-9');
    });

    it('시트에 있으면 관용과 무관하게 평소대로 ref 가 된다', () => {
      const { refs, errors } = resolveImageRefs(
        updateRow({ thumbnailImageKey: 'IMG-1' }),
        sheet,
        prefilled(['thumbnailImageKey', 'additionalImageKeys', 'description']),
      );

      expect(errors).toEqual([]);
      expect(refs).toEqual([{ imageKey: 'IMG-1', usage: 'main' }]);
    });

    it('신규 행에는 관용이 없다 — 기준 스냅샷이 없으므로 근거를 댈 수 없다', () => {
      const { errors } = resolveImageRefs(imageRow({ thumbnailImageKey: 'IMG-1' }), empty);

      expect(errors[0].message).toContain('IMG-1');
    });
  });
});

describe('buildCategoryPathIndex / resolveCategories', () => {
  const flat = [
    { id: 'c1', path: '여성패션', isActive: true },
    { id: 'c2', path: '여성패션>티셔츠', isActive: true },
    { id: 'c3', path: '신상품', isActive: true },
  ];
  const index = buildCategoryPathIndex(flat);

  it('이름 경로를 id 로 해석하고 대표를 가려낸다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '여성패션>티셔츠', isPrimary: 'Y' },
        { categoryPath: '신상품', isPrimary: 'N' },
      ],
      index,
    );
    expect(result.categoryIds).toEqual(['c2', 'c3']);
    expect(result.primaryCategoryId).toBe('c2');
    expect(result.errors).toEqual([]);
  });

  it('없는 경로는 행 오류다', () => {
    const result = resolveCategories([{ categoryPath: '남성패션', isPrimary: 'Y' }], index);
    expect(result.errors[0].message).toContain('남성패션');
  });

  it('유일한 대표 행의 경로가 오타로 해석에 실패해도 오류는 경로 오류 하나뿐이다 (대표 오류가 겹치지 않는다)', () => {
    const result = resolveCategories([{ categoryPath: '남성패션', isPrimary: 'Y' }], index);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).not.toContain('대표');
  });

  it('대표 표시가 없어도 전부 해석에 성공하면 여전히 대표 오류다 (해석 성공 여부와 무관하다)', () => {
    const result = resolveCategories(
      [
        { categoryPath: '여성패션>티셔츠', isPrimary: 'N' },
        { categoryPath: '신상품', isPrimary: 'N' },
      ],
      index,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('대표');
  });

  it('같은 경로 문자열이 둘 이상이면 모호로 행 오류다 (조용히 하나를 고르지 않는다)', () => {
    // 형제 중 동명 카테고리가 있으면 이름 경로가 같아진다 — 1단계 검증 보고서 8b 가 넘긴 항목.
    const ambiguous = buildCategoryPathIndex([...flat, { id: 'c4', path: '신상품', isActive: true }]);
    const result = resolveCategories([{ categoryPath: '신상품', isPrimary: 'Y' }], ambiguous);
    expect(result.errors[0].message).toContain('모호');
    expect(result.categoryIds).toEqual([]);
  });

  it('대표가 0개면 행 오류다', () => {
    const result = resolveCategories([{ categoryPath: '신상품', isPrimary: 'N' }], index);
    expect(result.errors[0].message).toContain('대표');
  });

  it('대표가 2개면 행 오류다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '신상품', isPrimary: 'Y' },
        { categoryPath: '여성패션', isPrimary: 'Y' },
      ],
      index,
    );
    expect(result.errors[0].message).toContain('대표');
  });

  it('같은 카테고리를 두 번 적으면 행 오류다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '신상품', isPrimary: 'Y' },
        { categoryPath: '신상품', isPrimary: 'N' },
      ],
      index,
    );
    expect(result.errors[0].message).toContain('중복');
  });

  it('행이 하나도 없으면 오류도 결과도 없다 (카테고리 변경 없음이다)', () => {
    expect(resolveCategories([], index)).toEqual({ categoryIds: [], errors: [] });
  });
});
