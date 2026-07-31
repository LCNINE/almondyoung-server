import { ProductImportNormalizer } from './product-import.normalizer';
import { CategoryNode, comboKey } from '../dto/import.types';

const CATEGORIES: CategoryNode[] = [
  { id: 'c-women', name: '여성패션', slug: 'women', parentId: null },
  { id: 'c-knit', name: '니트', slug: 'women-knit', parentId: 'c-women' },
  { id: 'c-men', name: '남성패션', slug: 'men', parentId: null },
  { id: 'c-knit2', name: '니트', slug: 'men-knit', parentId: 'c-men' }, // 동명 형제(다른 부모)
];

function parsed(products: Record<string, string>[], options: Record<string, string>[] = []) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: options.map((cells, i) => ({ rowNumber: i + 1, cells })),
    variants: [],
    categories: [],
    constraints: [],
    images: [],
  };
}

describe('ProductImportNormalizer', () => {
  const normalizer = new ProductImportNormalizer();

  it('categoryPath(이름 경로)를 leaf id 로 해석하고 이름도 기록한다', () => {
    const [rec] = normalizer.normalize(
      parsed([{ productKey: 'P1', name: '니트A', categoryPath: '여성패션>니트' }]),
      CATEGORIES,
    );
    expect(rec.categoryIds).toEqual(['c-knit']);
    expect(rec.primaryCategoryId).toBe('c-knit');
    expect(rec.categoryNames).toEqual(['여성패션', '니트']);
    expect(rec.errors).toEqual([]);
  });

  it('해석 불가 categoryPath 는 에러', () => {
    const [rec] = normalizer.normalize(
      parsed([{ productKey: 'P1', name: 'x', categoryPath: '없는>경로' }]),
      CATEGORIES,
    );
    expect(rec.categoryIds).toEqual([]);
    expect(rec.errors.some((e) => e.sheet === 'Products' && /카테고리/.test(e.message))).toBe(true);
  });

  it('slug 정확 매칭도 허용한다', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: 'x', categoryPath: 'men-knit' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual(['c-knit2']);
  });

  it('Options 행을 productKey 로 묶어 옵션그룹을 만든다', () => {
    const [rec] = normalizer.normalize(
      parsed(
        [{ productKey: 'P1', name: 'x' }],
        [
          { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' },
          { productKey: 'P1', optionName: '사이즈', optionValues: 'S|M|L' },
        ],
      ),
      CATEGORIES,
    );
    expect(rec.options).toEqual([
      { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '파랑' }], sortOrder: 1 },
      {
        displayName: '사이즈',
        values: [{ displayName: 'S' }, { displayName: 'M' }, { displayName: 'L' }],
        sortOrder: 2,
      },
    ]);
  });

  it('파일 내 중복 productKey 는 에러', () => {
    const recs = normalizer.normalize(
      parsed([
        { productKey: 'P1', name: 'a' },
        { productKey: 'P1', name: 'b' },
      ]),
      CATEGORIES,
    );
    expect(recs[1].errors.some((e) => /중복/.test(e.message))).toBe(true);
  });

  it('존재하지 않는 productKey 를 참조하는 Options 행은 invalid 레코드로 surface 한다', () => {
    const recs = normalizer.normalize(
      parsed([{ productKey: 'P1', name: 'a' }], [{ productKey: 'GHOST', optionName: '색상', optionValues: '빨강' }]),
      CATEGORIES,
    );
    const ghost = recs.find((r) => r.productKey === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost!.errors.some((e) => e.sheet === 'Options')).toBe(true);
  });

  it('Options 시트의 sortOrder 를 옵션에 반영하고, 비면 시트 등장 순서를 쓴다', () => {
    const normalizer = new ProductImportNormalizer();
    const [rec] = normalizer.normalize(
      {
        products: [{ rowNumber: 1, cells: { productKey: 'P1', name: '니트' } }],
        options: [
          { rowNumber: 1, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S|M', sortOrder: '5' } },
          { rowNumber: 2, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강', sortOrder: '' } },
        ],
        variants: [],
        categories: [],
        constraints: [],
        images: [],
      },
      [],
    );

    expect(rec.options.map((o) => [o.displayName, o.sortOrder])).toEqual([
      ['사이즈', 5],
      ['색상', 1],
    ]);
  });

  describe('Variants 시트 — optionCombination 정규화', () => {
    const OPTS = [
      { rowNumber: 1, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑', sortOrder: '0' } },
      { rowNumber: 2, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S|L', sortOrder: '1' } },
    ];
    const PRODUCTS = [{ rowNumber: 1, cells: { productKey: 'P1', name: '니트' } }];

    it('comboKey 는 축 순서를 무시한다', () => {
      expect(
        comboKey([
          { name: '색상', value: '빨강' },
          { name: '사이즈', value: 'L' },
        ]),
      ).toBe(
        comboKey([
          { name: '사이즈', value: 'L' },
          { name: '색상', value: '빨강' },
        ]),
      );
    });

    it('축 순서가 뒤바뀐 조합도 같은 variant 로 해석한다', () => {
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [
            { rowNumber: 1, cells: { productKey: 'P1', optionCombination: '사이즈=L;색상=빨강', basePrice: '31000' } },
          ],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.errors).toEqual([]);
      expect(rec.variantOverrides).toHaveLength(1);
      expect(rec.variantOverrides[0].comboKey).toBe(
        comboKey([
          { name: '색상', value: '빨강' },
          { name: '사이즈', value: 'L' },
        ]),
      );
    });

    it.each([
      ['미존재 옵션명', '소재=울;사이즈=L', /소재/],
      ['미존재 옵션값', '색상=검정;사이즈=L', /검정/],
      ['부분 조합', '색상=빨강', /축/],
    ])('%s 은 행 오류다', (_label, combination, pattern) => {
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [{ rowNumber: 1, cells: { productKey: 'P1', optionCombination: combination } }],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.errors.some((e) => pattern.test(e.message))).toBe(true);
    });

    it('같은 조합을 두 번 지정하면 양쪽 다 오류다', () => {
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [
            { rowNumber: 1, cells: { productKey: 'P1', optionCombination: '색상=빨강;사이즈=L', basePrice: '31000' } },
            { rowNumber: 2, cells: { productKey: 'P1', optionCombination: '사이즈=L;색상=빨강', basePrice: '32000' } },
          ],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.errors.filter((e) => /중복/.test(e.message))).toHaveLength(2);
    });

    it('같은 축을 두 번 지정하고 다른 축을 생략하면 개수가 우연히 맞아도 오류다', () => {
      // 회귀: 축 이름 집합이 아니라 pairs.length 만 options.length 와 비교하면
      // "색상=빨강;색상=파랑"(사이즈 미지정) 이 개수(2)만 우연히 맞아 통과해버린다.
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [
            { rowNumber: 1, cells: { productKey: 'P1', optionCombination: '색상=빨강;색상=파랑', basePrice: '1000' } },
          ],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.errors.some((e) => /중복/.test(e.message) && /색상/.test(e.message))).toBe(true);
      expect(rec.errors.some((e) => /축/.test(e.message) && /누락/.test(e.message) && /사이즈/.test(e.message))).toBe(
        true,
      );
      expect(rec.variantOverrides).toHaveLength(0);
    });

    it('축이 중복되면 개수가 우연히 일치하지 않아도 중복 축 오류를 낸다', () => {
      // 개수(3) 는 options.length(2) 와 다르므로 옛 cardinality 체크로도 어떤 오류든 나긴 하지만,
      // "중복 축" 이라는 구체적 원인은 집합 비교 없이는 절대 드러나지 않는다.
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [
            {
              rowNumber: 1,
              cells: { productKey: 'P1', optionCombination: '색상=빨강;색상=파랑;사이즈=L', basePrice: '1000' },
            },
          ],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.errors.some((e) => /중복/.test(e.message) && /색상/.test(e.message))).toBe(true);
      expect(rec.variantOverrides).toHaveLength(0);
    });

    it('옵션이 없는(단일 variant) 상품에 Variants 행을 달면 "미존재 옵션명" 이 아니라 옵션 없음을 명확히 알린다', () => {
      // 옵션축 자체가 없으므로 OPTS 를 넘기지 않는다. 이 상품엔 target.options === [] 다.
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: [],
          variants: [{ rowNumber: 1, cells: { productKey: 'P1', optionCombination: '색상=빨강', basePrice: '31000' } }],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.variantOverrides).toHaveLength(0);
      expect(rec.errors).toHaveLength(1);
      expect(rec.errors[0]).toMatchObject({ sheet: 'Variants', rowNumber: 1 });
      expect(rec.errors[0].message).toMatch(/옵션이 없/);
      // 회귀 방지: 축 조회 실패로 오해하게 만드는 "미존재 옵션명" 류 문구가 섞이면 안 된다.
      expect(rec.errors[0].message).not.toMatch(/옵션명|옵션값|축을 전부/);
    });

    it('옵션이 없는 상품에 빈 optionCombination 의 Variants 행이 와도 같은 명확한 메시지를 낸다', () => {
      const [rec] = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: [],
          variants: [{ rowNumber: 1, cells: { productKey: 'P1', optionCombination: '', basePrice: '31000' } }],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(rec.variantOverrides).toHaveLength(0);
      expect(rec.errors).toHaveLength(1);
      expect(rec.errors[0].message).toMatch(/옵션이 없/);
      expect(rec.errors[0].message).not.toMatch(/필수입니다/);
    });

    it('존재하지 않는 productKey 참조는 오류 레코드가 된다', () => {
      const records = new ProductImportNormalizer().normalize(
        {
          products: PRODUCTS,
          options: OPTS,
          variants: [{ rowNumber: 1, cells: { productKey: 'NOPE', optionCombination: '색상=빨강;사이즈=L' } }],
          categories: [],
          constraints: [],
          images: [],
        },
        [],
      );
      expect(records.some((r) => r.errors.some((e) => e.sheet === 'Variants' && /productKey/.test(e.message)))).toBe(
        true,
      );
    });
  });
});

function parsedWith(
  products: Record<string, string>[],
  extra: {
    categories?: Record<string, string>[];
    constraints?: Record<string, string>[];
    images?: Record<string, string>[];
  } = {},
) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: [],
    variants: [],
    categories: (extra.categories ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
    constraints: (extra.constraints ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
    images: (extra.images ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
  };
}

describe('ProductImportNormalizer — Categories 시트', () => {
  const normalizer = new ProductImportNormalizer();

  it('여러 카테고리를 시트 순서대로 붙이고 isPrimary 를 대표로 삼는다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: '니트A' }], {
        categories: [
          { productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'N' },
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.categoryIds).toEqual(['c-knit2', 'c-knit']);
    expect(rec.primaryCategoryId).toBe('c-knit');
    // categoryNames 는 대표 카테고리의 조상 경로다 (프리뷰가 이걸 그린다)
    expect(rec.categoryNames).toEqual(['여성패션', '니트']);
    expect(rec.errors).toEqual([]);
  });

  it('Products.categoryPath 와 동시 사용은 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', categoryPath: '여성패션>니트' }], {
        categories: [{ productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /동시에/.test(e.message))).toBe(true);
    // 충돌 시 Categories 는 적용하지 않는다 — Products 쪽 해석만 남는다
    expect(rec.categoryIds).toEqual(['c-knit']);
  });

  it('isPrimary 가 0개면 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'N' }],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /isPrimary/.test(e.message))).toBe(true);
    expect(rec.categoryIds).toEqual([]);
  });

  it('isPrimary 가 2개면 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
          { productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'Y' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /isPrimary/.test(e.message))).toBe(true);
  });

  it('같은 카테고리 중복 지정은 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
          { productKey: 'P1', categoryPath: 'women-knit', isPrimary: 'N' }, // slug 로 같은 노드
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /중복/.test(e.message))).toBe(true);
  });

  it('해석 불가 경로는 행 오류이고 isPrimary 오류를 덧붙이지 않는다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'P1', categoryPath: '없는>경로', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    const messages = rec.errors.filter((e) => e.sheet === 'Categories').map((e) => e.message);
    expect(messages.some((m) => /카테고리 경로를 해석할 수 없습니다/.test(m))).toBe(true);
    // 경로가 안 풀린 상태에서 "isPrimary 가 0개다"까지 얹으면 원인이 흐려진다
    expect(messages.some((m) => /isPrimary/.test(m))).toBe(false);
  });

  it('존재하지 않는 productKey 참조는 stub 레코드로 남는다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'GHOST', categoryPath: '여성패션>니트', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    const ghost = records.find((r) => r.productKey === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost!.errors.some((e) => e.sheet === 'Categories' && /productKey/.test(e.message))).toBe(true);
  });
});

describe('ProductImportNormalizer — Constraints 시트', () => {
  const normalizer = new ProductImportNormalizer();

  it('상품에 구매제약 원본을 붙인다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [{ productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '2' }],
      }),
      CATEGORIES,
    );
    expect(rec.purchaseConstraintRaw).toEqual({
      rowNumber: 1,
      requiresMembershipRaw: 'Y',
      lifetimeQuantityLimitRaw: '2',
    });
    expect(rec.errors).toEqual([]);
  });

  it('한 상품에 두 행이면 두 번째가 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [
          { productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '' },
          { productKey: 'P1', requiresMembership: 'N', lifetimeQuantityLimit: '3' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Constraints' && e.rowNumber === 2)).toBe(true);
    // 첫 행은 살아있다 — 나중 행이 조용히 덮지 않는다
    expect(rec.purchaseConstraintRaw?.requiresMembershipRaw).toBe('Y');
  });

  it('존재하지 않는 productKey 참조는 stub 레코드로 남는다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [{ productKey: 'GHOST', requiresMembership: 'Y', lifetimeQuantityLimit: '' }],
      }),
      CATEGORIES,
    );
    const ghost = records.find((r) => r.productKey === 'GHOST');
    expect(ghost!.errors.some((e) => e.sheet === 'Constraints' && /productKey/.test(e.message))).toBe(true);
  });
});

describe('ProductImportNormalizer — Images 시트', () => {
  const normalizer = new ProductImportNormalizer();
  const IMAGES = [
    { imageKey: 'IMG-1', sourceUrl: 'https://e.example/1.jpg' },
    { imageKey: 'IMG-2', sourceUrl: 'https://e.example/2.jpg' },
    { imageKey: 'IMG-3', sourceUrl: 'https://e.example/3.jpg' },
  ];

  it('대표·부가 키를 main 용도로, 본문 디렉티브 키를 description 용도로 접합한다', () => {
    const [rec] = normalizer.normalize(
      parsedWith(
        [
          {
            productKey: 'P1',
            name: '니트A',
            thumbnailImageKey: 'IMG-1',
            additionalImageKeys: 'IMG-2|IMG-3',
            description: '부드러운 니트\n::product-image{imageKey="IMG-2"}',
          },
        ],
        { images: IMAGES },
      ),
      CATEGORIES,
    );
    expect(rec.errors).toEqual([]);
    expect(rec.thumbnailImageKey).toBe('IMG-1');
    expect(rec.additionalImageKeys).toEqual(['IMG-2', 'IMG-3']);
    expect(rec.descriptionImageKeys).toEqual(['IMG-2']);
    // IMG-2 는 main·description 양쪽에 쓰여 ref 가 둘이다 — 업로드도 두 번, fileId 도 둘.
    expect(rec.imageRefs).toEqual([
      { imageKey: 'IMG-1', usage: 'main', sourceUrl: 'https://e.example/1.jpg' },
      { imageKey: 'IMG-2', usage: 'main', sourceUrl: 'https://e.example/2.jpg' },
      { imageKey: 'IMG-3', usage: 'main', sourceUrl: 'https://e.example/3.jpg' },
      { imageKey: 'IMG-2', usage: 'description', sourceUrl: 'https://e.example/2.jpg' },
    ]);
  });

  it('대표와 부가에 같은 키를 지정해도 main ref 는 하나다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', thumbnailImageKey: 'IMG-1', additionalImageKeys: 'IMG-1|IMG-2' }], {
        images: IMAGES,
      }),
      CATEGORIES,
    );
    expect(rec.errors).toEqual([]);
    expect(rec.imageRefs).toEqual([
      { imageKey: 'IMG-1', usage: 'main', sourceUrl: 'https://e.example/1.jpg' },
      { imageKey: 'IMG-2', usage: 'main', sourceUrl: 'https://e.example/2.jpg' },
    ]);
  });

  it('이미지를 안 쓰는 행은 imageRefs 가 빈 배열이다', () => {
    const [rec] = normalizer.normalize(parsedWith([{ productKey: 'P1', name: 'x' }]), CATEGORIES);
    expect(rec.imageRefs).toEqual([]);
    expect(rec.errors).toEqual([]);
  });

  it('정의되지 않은 imageKey 참조는 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', thumbnailImageKey: 'GHOST' }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Products' && /GHOST/.test(e.message))).toBe(true);
    expect(rec.imageRefs).toEqual([]);
  });

  it('본문 디렉티브가 정의되지 않은 키를 가리켜도 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', description: '::product-image{imageKey="GHOST"}' }], {
        images: IMAGES,
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Products' && /GHOST/.test(e.message))).toBe(true);
  });

  it('부가 이미지 6개는 상품 행 오류', () => {
    const many = ['IMG-1', 'IMG-2', 'IMG-3', 'IMG-1', 'IMG-2', 'IMG-3'].join('|');
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', additionalImageKeys: many }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => /부가 이미지/.test(e.message))).toBe(true);
  });

  it('부가 이미지에 같은 키가 두 번이면 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', additionalImageKeys: 'IMG-2|IMG-2' }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => /중복/.test(e.message))).toBe(true);
  });

  it('imageKey 중복은 Images 스텁 오류이고 첫 행은 살아있다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', thumbnailImageKey: 'IMG-1' }], {
        images: [
          { imageKey: 'IMG-1', sourceUrl: 'https://e.example/first.jpg' },
          { imageKey: 'IMG-1', sourceUrl: 'https://e.example/second.jpg' },
        ],
      }),
      CATEGORIES,
    );
    const stub = records.find((r) => r.errors.some((e) => e.sheet === 'Images'));
    expect(stub).toBeDefined();
    expect(stub!.errors[0].rowNumber).toBe(2);
    const [product] = records;
    expect(product.imageRefs?.[0].sourceUrl).toBe('https://e.example/first.jpg');
  });

  it('http/https 가 아닌 sourceUrl 은 Images 스텁 오류', () => {
    for (const bad of ['file:///etc/passwd', 'gopher://x/1', 'ftp://e.example/a.jpg', '그냥문자열']) {
      const records = normalizer.normalize(
        parsedWith([{ productKey: 'P1', name: 'x' }], { images: [{ imageKey: 'IMG-1', sourceUrl: bad }] }),
        CATEGORIES,
      );
      expect(records.some((r) => r.errors.some((e) => e.sheet === 'Images' && /sourceUrl/.test(e.message)))).toBe(true);
    }
  });

  it('imageKey 나 sourceUrl 이 비면 Images 스텁 오류', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        images: [
          { imageKey: '', sourceUrl: 'https://e.example/1.jpg' },
          { imageKey: 'IMG-9', sourceUrl: '' },
        ],
      }),
      CATEGORIES,
    );
    expect(records.filter((r) => r.errors.some((e) => e.sheet === 'Images')).length).toBe(2);
  });
});
