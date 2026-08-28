'use client';

import { useMemo, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useUnsoldProducts } from '@/lib/services/analytics';
import { useStockValuationProducts, useStockValuationSummary } from '@/lib/services/inventory/queries';
import type { StockValuationSummary } from '@/lib/api/domains/inventory/stock-valuation.client';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { PaginationBar } from '../components/pagination';
import { defaultRange, formatCount, formatKrw } from '../shared';

const PAGE_SIZE = 50;

const STATE_LABELS: Record<string, string> = {
  ON_HAND: '보유 (ON_HAND)',
  DEFECTIVE: '불량',
  IN_TRANSFER: '창고 이동 중',
};

const SORT_OPTIONS = [
  { value: 'value', label: '재고 금액순' },
  { value: 'quantity', label: '재고 수량순' },
] as const;

const ORDER_OPTIONS = [
  { value: 'desc', label: '상위' },
  { value: 'asc', label: '하위' },
] as const;

/** 원가 판정 불가 4버킷 합 — 배너·KPI 공용 */
function uncostedTotals(summary: StockValuationSummary | undefined) {
  if (!summary) return { skuCount: 0, quantity: 0 };
  const buckets = [summary.costMissing, summary.costConflict, summary.multiMaster, summary.unmatched];
  return {
    skuCount: buckets.reduce((acc, bucket) => acc + bucket.skuCount, 0),
    quantity: buckets.reduce((acc, bucket) => acc + bucket.onHandQuantity, 0),
  };
}

export default function InventoryStatisticsTemplate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sort = searchParams.get('sort') === 'quantity' ? 'quantity' : 'value';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const [page, setPage] = useState(1);
  const [unsoldPage, setUnsoldPage] = useState(1);

  const summary = useStockValuationSummary();
  const products = useStockValuationProducts({ page, limit: PAGE_SIZE, sort, order });

  // 악성 재고 = 최근 30일 무판매(analytics) × 재고 금액(core) — masterId 로 화면 병합
  const staleRange = useMemo(() => defaultRange(), []);
  const unsold = useUnsoldProducts({
    from: staleRange.from,
    to: staleRange.to,
    limit: PAGE_SIZE,
    page: unsoldPage,
  });
  const unsoldMasterIds = useMemo(
    () => (unsold.data?.items ?? []).map((row) => row.masterId),
    [unsold.data],
  );
  const unsoldValuation = useStockValuationProducts(
    { masterIds: unsoldMasterIds, limit: PAGE_SIZE },
    { enabled: unsoldMasterIds.length > 0 },
  );
  const valuationByMaster = useMemo(
    () => new Map((unsoldValuation.data?.data ?? []).map((row) => [row.masterId, row])),
    [unsoldValuation.data],
  );

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    setPage(1);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const data = summary.data;
  const uncosted = uncostedTotals(data);
  const isError = summary.isError;

  return (
    <StatisticsShell hideFilter>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          재고 통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              label="재고 금액 (묶인 돈)"
              value={formatKrw(data?.onHandValue)}
              hint="보유(ON_HAND) 수량 × 원가 · 원가 판정 가능한 SKU 만"
              isLoading={summary.isLoading}
            />
            <KpiTile
              label="보유 수량"
              value={formatCount(data?.onHandQuantity)}
              hint={`재고 보유 SKU ${formatCount(data?.stockedSkuCount)}개`}
              isLoading={summary.isLoading}
            />
            <KpiTile
              label="원가 판정 불가 재고"
              value={formatCount(uncosted.quantity)}
              hint={`SKU ${formatCount(uncosted.skuCount)}개 — 금액에서 제외됨`}
              isLoading={summary.isLoading}
            />
            <KpiTile
              label="품절 품목 보유 상품"
              value={formatCount(data?.soldOutMasterCount)}
              hint="수동 품절·재고 부족 사유 · 재고 보유 여부와 무관한 전체 기준"
              isLoading={summary.isLoading}
            />
          </div>

          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-800">이 금액은 경영 판단용 근사치입니다 — 회계 장부가 아닙니다.</span>{' '}
            상품에 현재 등록된 공급가로 계산하므로, 실제 매입가(취득원가)를 선입선출·가중평균으로 잡는 회계상
            재고자산 평가와 다릅니다. 공급가를 수정하면 과거 시점의 재고 금액도 함께 바뀝니다. 불량 재고도
            정상 원가로 계산되니 세 상태를 합쳐 &lsquo;총 재고자산&rsquo;으로 읽지 마세요.
          </p>

          {data && uncosted.quantity > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              원가를 판정할 수 없는 SKU {formatCount(uncosted.skuCount)}개(보유 수량{' '}
              {formatCount(uncosted.quantity)})는 재고 금액에서 제외됐습니다 — 원가 미입력{' '}
              {formatCount(data.costMissing.skuCount)} · 원가 상충 {formatCount(data.costConflict.skuCount)} ·
              다중 상품 연결 {formatCount(data.multiMaster.skuCount)} · 카탈로그 미연결{' '}
              {formatCount(data.unmatched.skuCount)}. 표시된 금액은 실제보다 작을 수 있습니다.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="상태별 재고"
              description="전 창고 합계 · 금액은 원가 판정 가능한 SKU 만 · 불량·이동중도 정상 원가로 계산"
              isLoading={summary.isLoading}
              isEmpty={!data || data.states.every((row) => row.quantity === 0)}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">상태</th>
                      <th className="py-1.5 text-right">수량</th>
                      <th className="py-1.5 text-right">재고 금액</th>
                      <th className="py-1.5 text-right">금액 제외 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.states ?? []).map((row) => (
                      <tr key={row.state} className="border-b last:border-0">
                        <td className="py-1.5 font-medium text-gray-900">{STATE_LABELS[row.state] ?? row.state}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantity)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{formatKrw(row.value)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">
                          {formatCount(row.uncostedQuantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard
              title="창고별 재고 금액"
              description="보유(ON_HAND) 기준"
              isLoading={summary.isLoading}
              isEmpty={!data || data.warehouses.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">창고</th>
                      <th className="py-1.5 text-right">수량</th>
                      <th className="py-1.5 text-right">재고 금액</th>
                      <th className="py-1.5 text-right">금액 제외 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.warehouses ?? []).map((row) => (
                      <tr key={row.warehouseId} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{row.warehouseName || row.warehouseId}</span>
                          {row.isSellable ? (
                            <span className="ml-1.5 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700">
                              판매
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.onHandQuantity)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{formatKrw(row.onHandValue)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">
                          {formatCount(row.uncostedQuantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>

          <ChartCard
            title="상품별 재고 금액"
            description="상품(master)별 보유 수량 × 원가. 원가 판정 불가 SKU 가 섞인 상품은 금액이 과소일 수 있어 표시해둡니다."
            isLoading={products.isLoading}
            isEmpty={!products.data || products.data.data.length === 0}
          >
            <div className="mb-2 flex items-center justify-end gap-1.5 text-xs">
              <select
                value={sort}
                onChange={(event) => setParam('sort', event.target.value)}
                className="rounded border border-gray-200 px-1.5 py-1"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={order}
                onChange={(event) => setParam('order', event.target.value)}
                className="rounded border border-gray-200 px-1.5 py-1"
              >
                {ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">SKU 수</th>
                    <th className="py-1.5 text-right">보유 수량</th>
                    <th className="py-1.5 text-right">재고 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(products.data?.data ?? []).map((row, index) => (
                    <tr key={row.masterId} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{(page - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                        {row.hasUncostedSku ? (
                          <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700">
                            원가 일부 미상
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.skuCount)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.onHandQuantity)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{formatKrw(row.onHandValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={products.data?.total}
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              unitLabel="개 상품"
            />
          </ChartCard>

          <ChartCard
            title="악성 재고 (최근 30일 무판매 × 묶인 돈)"
            description={`${staleRange.from} ~ ${staleRange.to} 판매 0건인 활성 상품에 현재 재고 금액을 붙였습니다. 마지막 판매일이 오래된 순 — 위에서부터 털(할인·번들·반품)지 검토 대상입니다.`}
            isLoading={unsold.isLoading || (unsoldMasterIds.length > 0 && unsoldValuation.isLoading)}
            isEmpty={!unsold.data || unsold.data.items.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">마지막 판매일</th>
                    <th className="py-1.5 text-right">보유 수량</th>
                    <th className="py-1.5 text-right">재고 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(unsold.data?.items ?? []).map((row, index) => {
                    const valuation = valuationByMaster.get(row.masterId);
                    return (
                      <tr key={row.masterId} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400">{(unsoldPage - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                          {valuation?.hasUncostedSku ? (
                            <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700">
                              원가 일부 미상
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.lastSoldDate ?? <span className="text-gray-400">판매 기록 없음</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {valuation ? formatCount(valuation.onHandQuantity) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {valuation ? (
                            formatKrw(valuation.onHandValue)
                          ) : (
                            <span className="text-gray-400">재고 없음</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={unsold.data?.total}
              page={unsoldPage}
              pageSize={PAGE_SIZE}
              onPageChange={setUnsoldPage}
              unitLabel="개 상품"
            />
          </ChartCard>
        </div>
      )}
    </StatisticsShell>
  );
}
