import type { ProductExportFiltersDto } from '@/lib/types/dto/products';

export type ExportScope = 'filtered' | 'selected';

/**
 * 현재 목록 URL 의 검색 조건을 내보내기 필터로 옮긴다.
 *
 * 목록은 URL 이라 supplierId 를 콤마 문자열로 싣지만 내보내기는 JSON body 라
 * 배열이다. 화면에 보이는 결과와 파일 내용이 어긋나면 안 되므로 여기서 한 번에 변환한다.
 */
export function toExportFilters(
  params: URLSearchParams
): ProductExportFiltersDto {
  const str = (key: string) => params.get(key)?.trim() || undefined;
  const list = (key: string) => {
    const raw = params.get(key);
    if (!raw) return undefined;
    const values = raw.split(',').filter(Boolean);
    return values.length > 0 ? values : undefined;
  };

  const status = str('status');
  const stock = str('stock');
  const sort = str('sort');
  const order = str('order');

  return {
    q: str('q'),
    categoryId: str('categoryId'),
    brand: str('brand'),
    status:
      status === 'active' || status === 'inactive' || status === 'draft'
        ? status
        : undefined,
    // 목록 훅과 같은 규칙 — 판매안함/작성중을 보려면 mode 를 넓혀야 한다.
    mode:
      status === 'inactive'
        ? 'active-or-inactive'
        : status === 'draft'
          ? 'all'
          : undefined,
    stock:
      stock === 'in_stock' || stock === 'partial' || stock === 'sold_out'
        ? stock
        : undefined,
    createdBy: str('createdBy'),
    supplierId: list('supplierId'),
    createdFrom: str('createdFrom'),
    createdTo: str('createdTo'),
    sort:
      sort === 'createdAt' || sort === 'name' || sort === 'updatedAt'
        ? sort
        : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
  };
}

/** 파일명. 프록시가 Content-Disposition 을 떨어뜨려 프론트가 정해야 한다. */
export function exportFileName(scope: ExportScope, now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const suffix = scope === 'selected' ? '선택' : '검색결과';
  return `상품목록_${suffix}_${stamp}.xlsx`;
}

/** 체크 토글. 선택 순서를 열 순서로 쓰므로 뒤에 붙인다. */
export function toggleKey(keys: string[], key: string): string[] {
  return keys.includes(key)
    ? keys.filter((k) => k !== key)
    : [...keys, key];
}

/**
 * 저장된 양식의 key 중 카탈로그에 없는 것(삭제된 항목)을 걸러낸다.
 * 서버도 같은 방어를 하지만, 화면 체크 상태가 어긋나지 않게 프론트에서도 정리한다.
 */
export function sanitizeKeys(keys: string[], available: string[]): string[] {
  const allowed = new Set(available);
  return keys.filter((k) => allowed.has(k));
}
