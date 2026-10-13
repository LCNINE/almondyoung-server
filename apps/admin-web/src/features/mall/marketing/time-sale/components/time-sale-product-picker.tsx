'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  type MedusaCategoryItem,
  type MedusaProductItem,
} from '@/lib/api/domains/medusa/catalog';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  useMedusaProductCategories,
  useMedusaProductSearch,
  useTimeSaleProductRows,
  useTimeSaleVariantMap,
} from '@/lib/services/time-sale';

const PAGE_SIZE = 10;

const runningSaleOf = (
  product: MedusaProductItem,
  variantMap: Map<string, string>
): string | null => {
  for (const variant of product.variants ?? []) {
    const title = variantMap.get(variant.id);

    if (title) return title;
  }

  return null;
};

export function TimeSaleProductPicker({
  selectedIds,
  onToggle,
  onToggleMany,
  /** 편집 중인 세일 id. 그 세일에 걸린 상품은 "진행 중" 으로 막지 않는다 — 자기 자신이다. */
  excludeId,
}: {
  selectedIds: string[];
  onToggle: (productId: string) => void;
  onToggleMany: (productIds: string[], next: boolean) => void;
  excludeId?: string;
}) {
  const [keyword, setKeyword] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);

  const { data, isFetching, isError, refetch } = useMedusaProductSearch({
    keyword: submitted,
    page,
    pageSize: PAGE_SIZE,
    categoryId: categoryId || undefined,
  });

  const categories = useMedusaProductCategories();

  const categoryName = (category: MedusaCategoryItem) => {
    const names = [category.name];
    const visited = new Set([category.id]);

    let parentId = category.parent_category_id;

    while (parentId && !visited.has(parentId)) {
      const parent = categories.data?.find((item) => item.id === parentId);

      if (!parent) break;

      names.unshift(parent.name);
      visited.add(parent.id);
      parentId = parent.parent_category_id;
    }

    return names.join(' / ');
  };

  const { data: variantMap } = useTimeSaleVariantMap(excludeId);

  const products = data?.products ?? [];

  const { data: prices } = useTimeSaleProductRows(
    products.map((product) => product.id)
  );

  const total = data?.count ?? 0;

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const blockingSaleOf = (product: MedusaProductItem) => {
    return runningSaleOf(product, variantMap);
  };

  const selectable = products.filter((product) => !blockingSaleOf(product));

  const allChecked =
    selectable.length > 0 &&
    selectable.every((product) => selectedIds.includes(product.id));

  const search = () => {
    const nextKeyword = keyword.trim();

    if (page === 1 && submitted === nextKeyword) void refetch();

    setPage(1);
    setSubmitted(nextKeyword);
  };

  const pagination = (
    <div className="ts-picker-pagination">
      <button
        className="ts-icon-button"
        aria-label="이전 페이지"
        disabled={page <= 1 || isFetching}
        onClick={() => setPage(page - 1)}
      >
        ‹
      </button>
      {Array.from(
        { length: Math.min(5, lastPage) },
        (_, i) => Math.min(Math.max(1, page - 2), Math.max(1, lastPage - 4)) + i
      ).map((value) => (
        <button
          key={value}
          className={`ts-page-button ${page === value ? 'active' : ''}`}
          aria-label={`${value} 페이지`}
          aria-current={page === value ? 'page' : undefined}
          disabled={isFetching}
          onClick={() => setPage(value)}
        >
          {value}
        </button>
      ))}
      {lastPage > 5 && page < lastPage - 2 && (
        <>
          <span>…</span>
          <button className="ts-page-button" onClick={() => setPage(lastPage)}>
            {lastPage}
          </button>
        </>
      )}
      <button
        className="ts-icon-button"
        aria-label="다음 페이지"
        disabled={page >= lastPage || isFetching}
        onClick={() => setPage(page + 1)}
      >
        ›
      </button>
      <span>
        Current {total ? (page - 1) * PAGE_SIZE + 1 : 0} ~{' '}
        {Math.min(page * PAGE_SIZE, total)} of #Total{' '}
        {total.toLocaleString('ko-KR')}
      </span>
    </div>
  );

  return (
    <div className="ts-product-picker">
      <div className="ts-picker-search">
        <label>
          상품분류:{' '}
          <select
            aria-label="상품분류"
            disabled={categories.isPending || categories.isError}
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">
              {categories.isPending
                ? '분류 불러오는 중…'
                : categories.isError
                  ? '분류 조회 실패'
                  : '- 전체 분류 -'}
            </option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryName(category)}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="상품명"
          placeholder="상품명"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') search();
          }}
        />
        <button
          className="ts-icon-button"
          aria-label="상품 검색"
          disabled={isFetching}
          onClick={search}
        >
          <RefreshCw size={22} />
        </button>
      </div>
      {categories.isError && (
        <p role="alert" className="ts-price-error">
          상품분류를 불러오지 못했습니다.
          <button
            className="ts-button"
            onClick={() => void categories.refetch()}
          >
            다시 불러오기
          </button>
        </p>
      )}
      {pagination}
      <div className="ts-table-scroll">
        <table className="ts-table ts-picker-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="이 페이지 전체 선택"
                  checked={allChecked}
                  disabled={!selectable.length || isFetching}
                  onChange={(event) =>
                    onToggleMany(
                      selectable.map((product) => product.id),
                      event.target.checked
                    )
                  }
                />
              </th>
              <th>상품번호</th>
              <th>상품코드</th>
              <th>상품명</th>
              <th>진열</th>
              <th>판매</th>
              <th>세트상품</th>
              <th>소비자가</th>
              <th>판매가</th>
              <th>대표이미지</th>
              <th>
                타임세일
                <br />
                번호
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const running = blockingSaleOf(product);

              const row = prices?.find((row) => row.productId === product.id);

              return (
                <tr
                  key={product.id}
                  className={
                    selectedIds.includes(product.id) ? 'ts-row-selected' : ''
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={product.title}
                      checked={selectedIds.includes(product.id)}
                      disabled={!!running || isFetching}
                      onChange={() => onToggle(product.id)}
                    />
                  </td>
                  <td>{product.id.slice(-8)}</td>
                  <td>{product.variants?.[0]?.sku || '-'}</td>
                  <td className="ts-name">{product.title}</td>
                  <td>{product.status === 'published' ? '예' : '아니오'}</td>
                  <td>{product.status === 'published' ? '예' : '아니오'}</td>
                  <td>-</td>
                  <td>-</td>
                  <td>{row?.basePrice.toLocaleString('ko-KR') ?? '-'}</td>
                  <td>
                    {product.thumbnail ? (
                      // 외부 상품 이미지 URL을 그대로 사용하는 관리 화면의 미리보기.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolvePublicFileUrl(product.thumbnail) ?? ''}
                        alt={product.title}
                        className="ts-product-image"
                      />
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{running || '-'}</td>
                </tr>
              );
            })}
            {!products.length && (
              <tr>
                <td colSpan={11}>
                  {isError
                    ? '상품을 불러오지 못했습니다. 다시 검색해 주세요.'
                    : isFetching
                      ? '불러오는 중…'
                      : '상품이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination}
    </div>
  );
}
