import { useId, useState } from 'react';
import { Info, Plus, Search } from 'lucide-react';
import { Button } from '../../core/design/Button';
import { SkuInfoSheet, SkuThumbnail } from '../inventory/SkuInfoSheet';
import { useSkuSearch } from '../inventory/useSkuSearch';
import type { SkuSearchItem } from '../inventory/types';
import { useWaitingOrders } from './waitingOrders';

const PAGE = 20;

export const A_SMALL_BUTTON =
  'border border-[#e4e4e7] bg-white px-2.5 py-[7px] text-xs text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';

export function QuickCatalog({
  disabled,
  onSelect,
  warehouseId,
}: {
  disabled: boolean;
  onSelect: (sku: SkuSearchItem) => void;
  warehouseId: string | null;
}) {
  const id = useId();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [viewing, setViewing] = useState<SkuSearchItem | null>(null);
  const result = useSkuSearch({
    search,
    limit: PAGE,
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
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  const waiting = useWaitingOrders(
    warehouseId,
    items.map((sku) => sku.id)
  );

  return (
    <div className="flex min-w-0 flex-col gap-[17px]">
      <form
        className="flex items-center gap-2 rounded-[10px] border border-[#e4e4e7] bg-white px-[15px] py-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setOffset(0);
          setSearch(term.trim());
        }}
      >
        <Search
          className="h-[23px] w-[23px] shrink-0 text-[#2563eb]"
          aria-hidden
        />
        <label htmlFor={id} className="sr-only">
          상품명·코드 검색
        </label>
        <input
          id={id}
          disabled={disabled}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="상품명 · 코드 검색"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent p-[5px] text-sm outline-none"
        />
        <Button
          type="submit"
          className={A_SMALL_BUTTON}
          disabled={disabled || !term.trim()}
        >
          검색
        </Button>
      </form>

      {search && result.data && !result.isError ? (
        <div className="flex items-center gap-2 text-xs text-[#71717a]">
          <small className="ml-auto text-xs">{total}개 상품</small>
        </div>
      ) : null}

      {result.isFetching ? (
        <p role="status" className="text-[13px] text-[#71717a]">
          상품을 찾고 있어요.
        </p>
      ) : null}
      {result.isError ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-[13px] text-[#aa4037]"
        >
          상품을 확인하지 못했어요.
          <Button
            type="button"
            className={A_SMALL_BUTTON}
            disabled={disabled}
            onClick={() => void result.refetch()}
          >
            다시 확인
          </Button>
        </div>
      ) : null}

      {!search ? (
        <p className="rounded-[10px] border border-dashed border-[#e4e4e7] p-[30px] text-center text-[13px] text-[#71717a]">
          상품명이나 코드로 검색하거나 바코드를 스캔해 주세요.
        </p>
      ) : !blocked && total === 0 ? (
        <p className="p-[30px] text-center text-[13px] text-[#71717a]">
          검색 결과가 없어요. 상품명이나 코드를 다시 확인해 주세요.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-[11px] min-[1101px]:grid-cols-3">
          {items.map((sku) => {
            const waits = waiting.of(sku.id);

            return (
              <li key={sku.id} className="relative min-w-0">
                <button
                  type="button"
                  aria-label={`${sku.name} 선택`}
                  disabled={blocked}
                  onClick={() => onSelect(sku)}
                  className="block h-full w-full rounded-[10px] border border-[#e4e4e7] bg-white px-[15px] py-[18px] text-left hover:border-[#2563eb] hover:shadow-[0_3px_10px_#00000008] disabled:opacity-60 disabled:hover:border-[#e4e4e7]"
                >
                  <span className="absolute top-3 right-3 grid h-[23px] w-[23px] place-items-center rounded-full bg-white text-[#2563eb] shadow-[0_1px_5px_#00000008]">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <SkuThumbnail
                    fileIds={sku.imageFileIds}
                    className="mb-[14px] h-[90px] w-full rounded-[7px] bg-[#f4f4f5]"
                  />
                  <strong className="block truncate text-[13px] leading-[1.6] font-semibold text-[#27272a]">
                    {sku.name}
                  </strong>
                  {sku.optionKey ? (
                    <small className="mt-1 block truncate text-[11px] text-[#71717a]">
                      {sku.optionKey}
                    </small>
                  ) : null}
                  <small className="mt-1 block truncate font-mono text-[11px] text-[#71717a]">
                    {sku.code}
                  </small>
                  {waits ? (
                    <span className="mt-[9px] inline-flex rounded-[5px] bg-[#fff1d9] px-1.5 py-1 text-[10px] font-semibold text-[#925e13]">
                      미발송 주문 {waits.orders}건
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`${sku.name} 상품 정보`}
                  disabled={disabled}
                  onClick={() => setViewing(sku)}
                  className="absolute right-2 bottom-2 grid h-[30px] w-[30px] place-items-center rounded-[7px] text-[#71717a] hover:bg-[#eff6ff] disabled:opacity-40"
                >
                  <Info className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {search && total > PAGE ? (
        <div className="flex gap-2">
          <Button
            type="button"
            className={A_SMALL_BUTTON}
            disabled={blocked || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - PAGE))}
          >
            이전
          </Button>
          <Button
            type="button"
            className={A_SMALL_BUTTON}
            disabled={blocked || offset + PAGE >= total}
            onClick={() => setOffset((v) => v + PAGE)}
          >
            다음
          </Button>
        </div>
      ) : null}

      {viewing ? (
        <SkuInfoSheet
          sku={viewing}
          canSelect={!blocked}
          onSelect={() => {
            onSelect(viewing);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
