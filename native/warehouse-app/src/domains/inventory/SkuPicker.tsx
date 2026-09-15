import { useId, useState } from 'react';
import { Button } from '../../core/design/Button';
import { useSkuSearch } from './useSkuSearch';
import type { SkuSearchItem } from './types';
export type SelectedSku = Pick<
  SkuSearchItem,
  'id' | 'code' | 'name' | 'optionKey'
>;
export function SkuPicker({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (sku: SelectedSku) => void;
}) {
  const id = useId();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const result = useSkuSearch({
    search,
    limit: 20,
    offset,
    sortBy: 'code',
    sortOrder: 'asc',
  });
  const blocked =
    disabled ||
    !search ||
    term.trim() !== search ||
    result.isFetching ||
    result.isPlaceholderData ||
    result.isError;
  return (
    <section className="space-y-2 rounded border p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setOffset(0);
          setSearch(term.trim());
        }}
      >
        <label htmlFor={id} className="sr-only">
          상품명·코드 검색
        </label>
        <input
          id={id}
          disabled={disabled}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="상품명·코드 검색"
          className="min-w-0 flex-1 rounded border px-3 py-2"
        />
        <Button type="submit" disabled={disabled || !term.trim()}>
          검색
        </Button>
      </form>
      {result.isFetching && <p role="status">상품을 찾고 있어요.</p>}
      {result.isError && (
        <div role="alert">
          상품을 확인하지 못했어요.{' '}
          <Button
            type="button"
            disabled={disabled}
            onClick={() => void result.refetch()}
          >
            다시 확인
          </Button>
        </div>
      )}
      {!blocked && result.data?.total === 0 && <p>검색 결과가 없어요.</p>}
      <ul className="space-y-1">
        {result.data?.items.map((sku) => (
          <li
            key={sku.id}
            className="flex items-center justify-between gap-2 border-b py-2"
          >
            <span>
              {sku.name}
              <span className="block text-xs text-gray-500">
                {sku.code}
                {sku.optionKey ? ` · ${sku.optionKey}` : ''}
              </span>
            </span>
            <Button
              type="button"
              aria-label={`${sku.name} 선택`}
              disabled={!!blocked}
              onClick={() => onSelect(sku)}
            >
              선택
            </Button>
          </li>
        ))}
      </ul>
      {search && (result.data?.total ?? 0) > 20 && (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={!!blocked || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 20))}
          >
            이전
          </Button>
          <Button
            type="button"
            disabled={!!blocked || offset + 20 >= (result.data?.total ?? 0)}
            onClick={() => setOffset((v) => v + 20)}
          >
            다음
          </Button>
        </div>
      )}
    </section>
  );
}
