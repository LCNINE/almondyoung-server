import { assembleUpload } from './bulk-upload.assembler';
import type { ParsedUpload } from './bulk-upload.parser';

const parsed = (over: Partial<ParsedUpload['sheets']> = {}): ParsedUpload => ({
  exportId: null,
  sheets: {
    products: [{ rowNumber: 1, cells: { rowKey: 'P-1', name: '티셔츠', basePrice: '19000' } }],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    ...over,
  },
  present: {
    products: new Set(['rowKey', 'name', 'basePrice']),
    options: new Set<string>(),
    variants: new Set<string>(),
    categories: new Set<string>(),
    constraints: new Set<string>(),
  },
});

describe('assembleUpload', () => {
  it('양식 잡에 있는 상품키는 수정이다', () => {
    const { rows } = assembleUpload(parsed(), new Set(['P-1']));
    expect(rows[0].kind).toBe('update');
  });

  it('양식 잡에 없는 상품키는 신규다', () => {
    const { rows } = assembleUpload(parsed(), new Set());
    expect(rows[0].kind).toBe('create');
  });

  it('상품키가 비면 행 오류다', () => {
    const p = parsed({ products: [{ rowNumber: 1, cells: { rowKey: '', name: 'x' } }] });
    expect(assembleUpload(p, new Set()).rows[0].errors[0].message).toContain('상품키');
  });

  it('파일 안에서 상품키가 중복되면 두 행 다 오류다 (복사한 행을 그대로 올린 경우)', () => {
    const p = parsed({
      products: [
        { rowNumber: 1, cells: { rowKey: 'P-1', name: 'a' } },
        { rowNumber: 2, cells: { rowKey: 'P-1', name: 'b' } },
      ],
    });
    const { rows } = assembleUpload(p, new Set(['P-1']));
    expect(rows[0].errors.map((e) => e.message).join()).toContain('중복');
    expect(rows[1].errors.map((e) => e.message).join()).toContain('중복');
  });

  it('부속 시트 행을 상품키로 접합한다', () => {
    const p = parsed({
      options: [{ rowNumber: 1, cells: { rowKey: 'P-1', optionKey: 'og1', optionValueKey: 'ov1' } }],
      variants: [{ rowNumber: 1, cells: { rowKey: 'P-1', combination: 'ov1' } }],
      categories: [{ rowNumber: 1, cells: { rowKey: 'P-1', categoryPath: '여성패션', isPrimary: 'Y' } }],
      constraints: [{ rowNumber: 1, cells: { rowKey: 'P-1', requiresMembership: 'Y' } }],
    });
    const { rows } = assembleUpload(p, new Set());
    expect(rows[0].bundle.options).toHaveLength(1);
    expect(rows[0].bundle.variants).toHaveLength(1);
    expect(rows[0].bundle.categories).toHaveLength(1);
    expect(rows[0].bundle.constraint?.requiresMembership).toBe('Y');
  });

  it('존재하지 않는 상품키를 참조한 부속 행은 시트 오류로 남는다', () => {
    const p = parsed({ options: [{ rowNumber: 3, cells: { rowKey: '없음', optionKey: 'og1' } }] });
    const { errors } = assembleUpload(p, new Set());
    expect(errors[0]).toMatchObject({ sheet: '옵션', rowNumber: 3 });
    expect(errors[0].message).toContain('없음');
  });

  it('구매제약이 상품당 두 행이면 행 오류다', () => {
    const p = parsed({
      constraints: [
        { rowNumber: 1, cells: { rowKey: 'P-1', requiresMembership: 'Y' } },
        { rowNumber: 2, cells: { rowKey: 'P-1', requiresMembership: 'N' } },
      ],
    });
    expect(assembleUpload(p, new Set()).rows[0].errors[0].message).toContain('한 행');
  });

  it('이미지 시트를 키 사전으로 만든다', () => {
    const p = parsed({ images: [{ rowNumber: 1, cells: { imageKey: 'IMG-1', sourceValue: 'a.jpg' } }] });
    expect(assembleUpload(p, new Set()).images.get('IMG-1')?.sourceValue).toBe('a.jpg');
  });

  it('이미지 키가 중복되면 시트 오류다 (뒤 행이 앞을 조용히 덮으면 안 된다)', () => {
    const p = parsed({
      images: [
        { rowNumber: 1, cells: { imageKey: 'IMG-1', sourceValue: 'a.jpg' } },
        { rowNumber: 2, cells: { imageKey: 'IMG-1', sourceValue: 'b.jpg' } },
      ],
    });
    const { errors, images } = assembleUpload(p, new Set());
    expect(errors[0].message).toContain('중복');
    expect(images.get('IMG-1')?.sourceValue).toBe('a.jpg'); // 첫 행이 이긴다
  });
});

function parsedWith(productRows: Array<Record<string, string>>): ParsedUpload {
  return {
    exportId: null,
    sheets: {
      products: productRows.map((cells, i) => ({ rowNumber: i + 2, cells })),
      options: [],
      variants: [],
      categories: [],
      constraints: [],
      images: [],
    },
    present: {
      products: new Set(['rowKey', 'name', 'basePrice']),
      options: new Set<string>(),
      variants: new Set<string>(),
      categories: new Set<string>(),
      constraints: new Set<string>(),
    },
  };
}

describe('assembleUpload — 예약 상품키', () => {
  it('매핑에 없는 예약 키 행은 오류로 표시한다 (다른 양식의 행을 섞은 경우)', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'P-000042', name: '티셔츠' }]), new Set());

    const row = out.rows[0];
    expect(row.kind).toBe('create');
    expect(row.errors.map((e) => e.message).join(' ')).toContain('P-000042');
  });

  it('매핑에 있는 예약 키는 정상 수정 행이다', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'P-000042', name: '티셔츠' }]), new Set(['P-000042']));

    expect(out.rows[0].kind).toBe('update');
    expect(out.rows[0].errors).toEqual([]);
  });

  it('예약 형식이 아닌 신규 키는 영향받지 않는다', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'NEW-001', name: '티셔츠' }]), new Set());

    expect(out.rows[0].kind).toBe('create');
    expect(out.rows[0].errors).toEqual([]);
  });
});
