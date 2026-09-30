import type { AdminAlmondTemplateDto } from '@/lib/types/dto/products';
import {
  almondTemplateEditorUrl,
  almondTemplateKindLabel,
  countByTab,
  filterAlmondTemplates,
  kindFilterOptions,
  KIND_FILTER_ALL,
  KIND_FILTER_NONE,
} from './almond-template-rules';

function template(
  overrides: Partial<AdminAlmondTemplateDto>
): AdminAlmondTemplateDto {
  return {
    id: 't1',
    title: '봄 이벤트 배너',
    productId: 'p1',
    kind: 'pet',
    size: '600x1800',
    colors: ['#ffffff'],
    industry: '미용·뷰티',
    purpose: '이벤트·홍보',
    status: 'draft',
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

const templates = [
  template({ id: 'a', title: '봄 이벤트 배너', kind: 'pet', status: 'draft' }),
  template({
    id: 'b',
    title: '가격표 기본',
    kind: 'menu',
    status: 'published',
  }),
  template({ id: 'c', title: '옛 시안', kind: null, status: 'published' }),
];

describe('아몬드템플릿 목록 필터', () => {
  it('탭별 건수를 센다', () => {
    expect(countByTab(templates)).toEqual({ all: 3, draft: 1, published: 2 });
  });

  it('상태·상품유형·제목을 함께 거른다', () => {
    const ids = (tab: 'all' | 'draft' | 'published', kind: string, q: string) =>
      filterAlmondTemplates(templates, { tab, kind, q }).map((t) => t.id);

    expect(ids('all', KIND_FILTER_ALL, '')).toEqual(['a', 'b', 'c']);
    expect(ids('published', KIND_FILTER_ALL, '')).toEqual(['b', 'c']);
    expect(ids('all', 'menu', '')).toEqual(['b']);
    expect(ids('all', KIND_FILTER_NONE, '')).toEqual(['c']);
    expect(ids('all', KIND_FILTER_ALL, ' 이벤트 ')).toEqual(['a']);
  });

  it('모르는 kind 는 값 그대로, 없는 kind 는 미지정으로 보인다', () => {
    expect(almondTemplateKindLabel('pet')).toBe('PET 입간판·X배너');
    expect(almondTemplateKindLabel('sticker')).toBe('sticker');
    expect(almondTemplateKindLabel(null)).toBe('미지정');

    const values = kindFilterOptions([
      ...templates,
      template({ kind: 'sticker' }),
    ]).map((o) => o.value);
    expect(values).toContain('sticker');
    expect(values[values.length - 1]).toBe(KIND_FILTER_NONE);
  });
});

describe('스토어프론트 편집기 주소', () => {
  it('디자이너 모드로 열고 템플릿이 있으면 id 를 싣는다', () => {
    expect(almondTemplateEditorUrl('https://almondyoung.com/', 'kr')).toBe(
      'https://almondyoung.com/kr/almond-template?mode=designer'
    );
    expect(almondTemplateEditorUrl('https://almondyoung.com', 'kr', 't1')).toBe(
      'https://almondyoung.com/kr/almond-template?mode=designer&template=t1'
    );
  });

  it('기본 주소가 없으면 null 이다', () => {
    expect(almondTemplateEditorUrl('', 'kr', 't1')).toBeNull();
  });
});
