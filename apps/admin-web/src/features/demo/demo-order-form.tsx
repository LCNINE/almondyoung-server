'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  buildPracticeItems,
  buildReplenishmentInput,
  type ReplenishmentInput,
  buildRunInput,
  type CatalogItem,
  type RunInput,
} from './demo-input';

type Props = {
  ready: boolean;
  busy: boolean;
  pending: boolean;
  loadCatalog: (
    query: string
  ) => Promise<{ items: CatalogItem[]; total: number }>;
  onSubmit: (input?: RunInput) => void;
  onPrepareReplenishment: (input: ReplenishmentInput) => void;
  onPrepare: (
    items: { skuId: string; quantity: number }[],
    prepareDemand: boolean
  ) => void;
};
const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100';

export function DemoOrderForm({
  ready,
  busy,
  pending,
  loadCatalog,
  onSubmit,
  onPrepare,
  onPrepareReplenishment,
}: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [mode, setMode] = useState<'specified' | 'random'>('random');
  const [scenario, setScenario] = useState<RunInput['scenario']>('happy_path');
  const [count, setCount] = useState(5);
  const [kinds, setKinds] = useState(2);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(3);
  const [replenishmentMode, setReplenishmentMode] = useState<
    'random' | 'specified'
  >('random');
  const [replenishmentCount, setReplenishmentCount] = useState(5);
  const [restock, setRestock] = useState(50);
  const [demand, setDemand] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ['demo', 'catalog-search', query, page],
    queryFn: () =>
      loadCatalog(`search=${encodeURIComponent(query)}&page=${page}&limit=20`),
  });
  const locked = busy || pending;
  const run = () => {
    if (pending) {
      onSubmit();
      return;
    }
    try {
      const input = buildRunInput({
        requestId: crypto.randomUUID(),
        scenario,
        count,
        mode,
        variantIds: products.map((item) => item.variantId),
        productsPerOrder: kinds,
        minQuantity: min,
        maxQuantity: max,
      });
      setError(null);
      onSubmit(input);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const prepare = () => {
    try {
      const items = buildPracticeItems(products, restock);
      setError(null);
      onPrepare(items, demand);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="rounded-xl border p-5">
      <h2 className="font-semibold">주문 생성 · 시연 상품 준비</h2>
      <p className="mt-2 text-sm text-slate-600">
        실제 상품을 선택하거나, 전체 후보에서 상품을 무작위로 섞어 주문을 만들
        수 있습니다.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
          setPage(1);
        }}
      >
        <input
          aria-label="시연 상품 검색"
          placeholder="상품명, SKU 또는 바코드"
          className={fieldClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="outline" type="submit">
          검색
        </Button>
      </form>
      {catalog.error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {(catalog.error as Error).message}
        </p>
      )}
      <div className="mt-3 max-h-72 overflow-auto rounded-lg border">
        {catalog.data?.items.map((item) => {
          const checked = products.some(
            (selected) => selected.variantId === item.variantId
          );
          return (
            <label
              key={item.variantId}
              className="flex cursor-pointer items-start gap-3 border-b p-3 text-sm last:border-0 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                disabled={locked || (!checked && products.length >= 50)}
                onChange={() =>
                  setProducts(
                    checked
                      ? products.filter((p) => p.variantId !== item.variantId)
                      : [...products, item]
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.productName}</span>
                <span className="block break-all text-xs text-slate-500">
                  {item.sku}
                </span>
              </span>
              <span className="whitespace-nowrap">
                가용 {item.availableQuantity.toLocaleString()}
              </span>
            </label>
          );
        })}
        {!catalog.isLoading && !catalog.data?.items.length && (
          <p className="p-5 text-sm text-slate-500">
            일치하는 주문 가능 상품이 없습니다.
          </p>
        )}
        {catalog.isLoading && (
          <p className="p-5 text-sm">상품을 불러오는 중…</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          후보 {(catalog.data?.total ?? 0).toLocaleString()}개 · 선택{' '}
          {products.length}개
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={locked || !products.length}
            onClick={() => setProducts([])}
          >
            선택 해제
          </Button>
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            이전
          </Button>
          <span className="py-2">{page}</span>
          <Button
            variant="outline"
            disabled={page * 20 >= (catalog.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            다음
          </Button>
        </div>
      </div>
      {products.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          선택: {products.map((item) => item.productName).join(', ')}
        </p>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>생성 방식</span>
          <select
            className={fieldClass}
            disabled={locked}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="random">무작위 여러 상품</option>
            <option value="specified">선택한 상품</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>시나리오</span>
          <select
            className={fieldClass}
            disabled={locked}
            value={scenario}
            onChange={(e) =>
              setScenario(e.target.value as RunInput['scenario'])
            }
          >
            <option value="happy_path">정상 출고</option>
            <option value="inventory_shortage">재고 부족 → 보충 후 출고</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>주문 수 (1–50)</span>
          <input
            className={fieldClass}
            disabled={locked}
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>주문당 상품 종류 (1–5)</span>
          <input
            className={fieldClass}
            disabled={locked}
            type="number"
            min={1}
            max={5}
            value={kinds}
            onChange={(e) => setKinds(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>품목당 최소 수량</span>
          <input
            className={fieldClass}
            disabled={locked}
            type="number"
            min={1}
            max={100}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>품목당 최대 수량</span>
          <input
            className={fieldClass}
            disabled={locked}
            type="number"
            min={1}
            max={100}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        무작위 방식에서 상품을 선택하면 선택한 범위에서만 추첨합니다. 선택하지
        않으면 전체 후보를 사용합니다. 재고 부족 시나리오는 설정 범위에서 부족이
        발생할 수 있어야 합니다.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {pending && (
        <p className="mt-3 text-sm text-amber-800">
          확인할 주문 요청이 있습니다. 같은 요청 재확인은 상품을 다시 추첨하거나
          주문을 중복 생성하지 않습니다.
        </p>
      )}
      <Button
        className="mt-4"
        onClick={run}
        disabled={busy || (!pending && !ready)}
      >
        {busy ? '처리 중…' : pending ? '같은 요청 재확인' : '주문 생성'}
      </Button>
      <div className="mt-6 border-t pt-5">
        <h3 className="font-medium">선택 상품의 시연 재고 보충</h3>
        <p className="mt-2 text-sm text-slate-600">
          선택 상품의 구성 SKU를 국내 데모 창고에 새로 입고·적치합니다. 기존
          재고와 진행 중인 작업은 보존됩니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-sm">
            <span>상품마다 준비할 수량</span>
            <input
              className={fieldClass}
              disabled={locked}
              type="number"
              min={1}
              max={1000}
              value={restock}
              onChange={(e) => setRestock(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={demand}
              disabled={locked}
              onChange={(e) => setDemand(e.target.checked)}
            />
            발주 추천용 수요 이력도 준비
          </label>
          <Button
            variant="outline"
            disabled={locked || !ready || !products.length}
            onClick={prepare}
          >
            선택 상품 보충
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          발주 후 입고·적치하는 작업 흐름은 발주 화면에서 시작할 수 있습니다.
          세트 상품은 구성 수량을 합산합니다.
        </p>
      </div>
      <div className="mt-6 border-t pt-5">
        <h3 className="font-medium">발주 제안용 데이터 준비</h3>
        <p className="mt-2 text-sm text-slate-600">
          기존 수요·재고·거래 이력이 없는 실제 상품에 최근 365일의 시연용 합성
          수요를 만듭니다. 실제 판매 이력이 아니며, 기존 작업과 재고는 변경하지
          않습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-sm">
            <span>발주 제안 상품 선택</span>
            <select
              className={fieldClass}
              disabled={locked}
              value={replenishmentMode}
              onChange={(e) =>
                setReplenishmentMode(
                  e.target.value === 'specified' ? 'specified' : 'random'
                )
              }
            >
              <option value="random">무작위 실제 상품</option>
              <option value="specified">위에서 직접 선택한 상품</option>
            </select>
          </label>
          {replenishmentMode === 'random' && (
            <label className="space-y-1 text-sm">
              <span>무작위 상품 수</span>
              <input
                className={fieldClass}
                disabled={locked}
                type="number"
                min={1}
                max={20}
                value={replenishmentCount}
                onChange={(e) => setReplenishmentCount(Number(e.target.value))}
              />
            </label>
          )}
          <Button
            disabled={locked || !ready}
            onClick={() => {
              try {
                const input = buildReplenishmentInput(
                  crypto.randomUUID(),
                  replenishmentMode,
                  replenishmentCount,
                  products
                );
                setError(null);
                onPrepareReplenishment(input);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : '상품 선택을 확인해 주세요.'
                );
              }
            }}
          >
            발주 제안 만들기
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          최대 20 SKU · 꾸준한 수요, 변동이 큰 수요, 간헐적 수요를 섞습니다.
          무작위 모드는 위의 상품 선택과 관계없이 전체 후보에서 새로 추첨합니다.
        </p>
      </div>
    </section>
  );
}
