import {
  exportFileName,
  sanitizeKeys,
  toExportFilters,
  toggleKey,
} from './excel-download-model';

const params = (qs: string) => new URLSearchParams(qs);

describe('엑셀 내보내기 모델', () => {
  describe('toExportFilters', () => {
    it('빈 URL 이면 전부 undefined — 필터 없이 전량이 된다', () => {
      expect(toExportFilters(params(''))).toEqual({
        q: undefined,
        categoryId: undefined,
        brand: undefined,
        status: undefined,
        mode: undefined,
        stock: undefined,
        createdBy: undefined,
        supplierId: undefined,
        createdFrom: undefined,
        createdTo: undefined,
        sort: undefined,
        order: undefined,
      });
    });

    it('supplierId 콤마 문자열을 배열로 바꾼다', () => {
      expect(toExportFilters(params('supplierId=a,b,c')).supplierId).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('unassigned sentinel 도 그대로 넘긴다 — 공급처 미지정이 빠지면 안 된다', () => {
      expect(
        toExportFilters(params('supplierId=a,unassigned')).supplierId
      ).toEqual(['a', 'unassigned']);
    });

    it('빈 supplierId 는 undefined — 빈 배열을 보내면 서버가 필터로 오해한다', () => {
      expect(toExportFilters(params('supplierId=')).supplierId).toBeUndefined();
      expect(toExportFilters(params('supplierId=,,')).supplierId).toBeUndefined();
    });

    it('status=inactive 면 mode 를 넓힌다 — 목록 훅과 같은 규칙', () => {
      expect(toExportFilters(params('status=inactive')).mode).toBe(
        'active-or-inactive'
      );
      expect(toExportFilters(params('status=draft')).mode).toBe('all');
      expect(toExportFilters(params('status=active')).mode).toBeUndefined();
    });

    it('모르는 enum 값은 버린다 — 서버 400 을 프론트에서 막는다', () => {
      expect(toExportFilters(params('status=weird')).status).toBeUndefined();
      expect(toExportFilters(params('stock=weird')).stock).toBeUndefined();
      expect(toExportFilters(params('sort=weird')).sort).toBeUndefined();
      expect(toExportFilters(params('order=weird')).order).toBeUndefined();
    });

    it('공백만 있는 검색어는 undefined', () => {
      expect(toExportFilters(params('q=%20%20')).q).toBeUndefined();
    });
  });

  describe('exportFileName', () => {
    it('범위와 시각을 담는다', () => {
      const at = new Date(2026, 6, 30, 9, 5);
      expect(exportFileName('filtered', at)).toBe(
        '상품목록_검색결과_20260730_0905.xlsx'
      );
      expect(exportFileName('selected', at)).toBe(
        '상품목록_선택_20260730_0905.xlsx'
      );
    });
  });

  describe('toggleKey', () => {
    it('없으면 뒤에 붙이고, 있으면 뺀다 — 선택 순서가 열 순서다', () => {
      expect(toggleKey(['a'], 'b')).toEqual(['a', 'b']);
      expect(toggleKey(['a', 'b'], 'a')).toEqual(['b']);
    });
  });

  describe('sanitizeKeys', () => {
    it('카탈로그에 없는 key 를 걸러낸다', () => {
      expect(sanitizeKeys(['a', 'gone', 'b'], ['a', 'b', 'c'])).toEqual([
        'a',
        'b',
      ]);
    });
  });
});
