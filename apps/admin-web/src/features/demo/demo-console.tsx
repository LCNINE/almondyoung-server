'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import { Button } from '@/components/ui/button';
import { DemoReplenishmentResult } from './demo-replenishment-result';
import { DemoOrderForm } from './demo-order-form';
import {
  retryRunInput,
  runWithActionLock,
  type RunInput,
  type CatalogItem,
  type PracticeInput,
  type ReplenishmentInput,
  type ReplenishmentResult,
} from './demo-input';

type Readiness = {
  ready: boolean;
  fixtureVersion: string;
  coverage?: {
    totalSkus: number;
    activeSkus: number;
    withoutSupplier: number;
    withoutBarcode: number;
    imported: {
      sourceSkuCount: number;
      importedSkuCount: number;
      missingSkuCount: number;
      importedAt: string;
    } | null;
  };
  checks: { key: string; ready: boolean; actual: number; expected: number }[];
};
type RunItem = {
  id: string;
  sequence: number;
  externalOrderId: string;
  status: string;
  error: string | null;
  lines?: {
    orderItemId: string;
    productName: string;
    sku: string;
    quantity: number;
  }[];
};
type Run = {
  id: string;
  requestId: string;
  scenario: RunInput['scenario'];
  status: string;
  count: number;
  quantity: number;
  variantId: string;
  createdAt: string;
  summary: { requested: number; enqueued: number; failed: number };
  items?: RunItem[];
  input?: Pick<
    RunInput,
    'mode' | 'variantIds' | 'productsPerOrder' | 'minQuantity' | 'maxQuantity'
  >;
};
const PENDING_KEY = 'demo-order-request-v1';

class DemoRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  body?: RunInput | PracticeInput | ReplenishmentInput
): Promise<T> {
  const response = await fetchWithRefresh(
    `/api/demo/${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new DemoRequestError(
      typeof json.message === 'string'
        ? json.message
        : `요청을 처리하지 못했습니다 (${response.status}).`,
      response.status
    );
  return (json.data ?? json) as T;
}

const statusLabels: Record<string, string> = {
  processing: '처리 중',
  completed: '이벤트 접수 완료',
  partial_failure: '일부 실패',
  failed: '실패',
  pending: '대기',
  enqueued: '이벤트 접수',
};

export function DemoConsole() {
  const queryClient = useQueryClient();
  const actionLock = useRef(false);
  const [pending, setPending] = useState<RunInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practicePending, setPracticePending] = useState<PracticeInput | null>(
    null
  );
  const [practiceResult, setPracticeResult] = useState<{
    receiptId: string;
    warehouseName: string;
    locationCode: string;
    demandPrepared: boolean;
    lines: { skuId: string; name: string; sku: string; quantity: number }[];
  } | null>(null);
  const [replenishmentPending, setReplenishmentPending] =
    useState<ReplenishmentInput | null>(null);
  const [replenishmentResult, setReplenishmentResult] =
    useState<ReplenishmentResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const readiness = useQuery({
    queryKey: ['demo', 'readiness'],
    queryFn: () => request<Readiness>('core/readiness'),
    refetchInterval: 15000,
  });
  const runs = useQuery({
    queryKey: ['demo', 'runs'],
    queryFn: () => request<{ items: Run[]; total: number }>('channel/runs'),
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ['demo', 'run', selected],
    queryFn: () => request<Run>(`channel/runs/${selected}`),
    enabled: !!selected,
    refetchInterval: 5000,
  });

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PENDING_KEY);
      if (saved) setPending(JSON.parse(saved));
      const practice = sessionStorage.getItem('demo-practice-request-v1');
      if (practice) setPracticePending(JSON.parse(practice));
      const replenishment = sessionStorage.getItem(
        'demo-replenishment-request-v1'
      );
      if (replenishment) setReplenishmentPending(JSON.parse(replenishment));
    } catch {
      setError('이전 요청을 복원하지 못했습니다. 생성 이력을 확인해 주세요.');
    }
  }, []);

  async function submit(existing?: RunInput) {
    const payload = existing ?? pending;
    if (!payload) return;
    await runWithActionLock(actionLock, async () => {
      setError(null);
      try {
        // Save before transport. A timeout never silently creates a second request identity.
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
        setPending(payload);
        setBusy(true);
        const result = await request<Run>('channel/runs', payload);
        setSelected(result.id);
        sessionStorage.removeItem(PENDING_KEY);
        setPending(null);
        await queryClient.invalidateQueries({ queryKey: ['demo', 'runs'] });
      } catch (e) {
        if (e instanceof DemoRequestError && e.status === 400) {
          sessionStorage.removeItem(PENDING_KEY);
          setPending(null);
        }
        setError(
          e instanceof Error
            ? e.message
            : '요청 결과를 확인하지 못했습니다. 같은 요청으로 재확인해 주세요.'
        );
      } finally {
        setBusy(false);
      }
    });
  }

  async function prepare(input: PracticeInput) {
    await runWithActionLock(actionLock, async () => {
      setBusy(true);
      setError(null);
      try {
        sessionStorage.setItem(
          'demo-practice-request-v1',
          JSON.stringify(input)
        );
        setPracticePending(input);
        const result = await request<NonNullable<typeof practiceResult>>(
          'core/practice',
          input
        );
        setPracticeResult(result);
        setPracticePending(null);
        sessionStorage.removeItem('demo-practice-request-v1');
        await queryClient.invalidateQueries({ queryKey: ['demo'] });
      } catch (e) {
        if (e instanceof DemoRequestError && e.status === 400) {
          setPracticePending(null);
          sessionStorage.removeItem('demo-practice-request-v1');
        }
        setError(
          e instanceof Error
            ? e.message
            : '보충 결과를 확인하지 못했습니다. 같은 요청으로 재확인해 주세요.'
        );
      } finally {
        setBusy(false);
      }
    });
  }

  async function prepareReplenishment(input: ReplenishmentInput) {
    await runWithActionLock(actionLock, async () => {
      setBusy(true);
      setError(null);
      setReplenishmentResult(null);
      try {
        sessionStorage.setItem(
          'demo-replenishment-request-v1',
          JSON.stringify(input)
        );
        setReplenishmentPending(input);
        const result = await request<ReplenishmentResult>(
          'core/replenishment',
          input
        );
        setReplenishmentResult(result);
        setReplenishmentPending(null);
        sessionStorage.removeItem('demo-replenishment-request-v1');
        await queryClient.invalidateQueries({ queryKey: ['demo'] });
        await queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      } catch (e) {
        if (e instanceof DemoRequestError && e.status === 400) {
          setReplenishmentPending(null);
          sessionStorage.removeItem('demo-replenishment-request-v1');
        }
        setError(
          e instanceof Error
            ? e.message
            : '생성 결과를 확인하지 못했습니다. 같은 요청으로 재확인해 주세요.'
        );
      } finally {
        setBusy(false);
      }
    });
  }

  const shipments = useQuery({
    queryKey: ['demo', 'shipments'],
    queryFn: () =>
      request<{
        items: {
          reference: string;
          trackingNumber: string;
          status: string;
          createdAt: string;
        }[];
      }>('core/shipments'),
    refetchInterval: 10000,
  });
  const notifications = useQuery({
    queryKey: ['demo', 'notifications'],
    queryFn: () =>
      request<{
        logs: {
          logId: string;
          result?: {
            recipient?: string;
            subject?: string;
            content?: string;
          } | null;
          channel: string;
          status: string;
          createdAt: string;
        }[];
      }>('notification/logs?limit=20'),
    refetchInterval: 10000,
  });
  const dispatches = useQuery({
    queryKey: ['demo', 'dispatch-outcomes'],
    queryFn: () =>
      request<{
        items: {
          id: string;
          operation: string;
          channel: string;
          status: string;
          error: string | null;
          createdAt: string;
        }[];
      }>('channel/dispatch-outcomes?limit=20'),
    refetchInterval: 10000,
  });
  const problems = [
    readiness.error,
    runs.error,
    detail.error,
    shipments.error,
    dispatches.error,
    notifications.error,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-700">
            DEMO · 물류 시연
          </p>
          <h1 className="mt-1 text-2xl font-bold">시연 콘솔</h1>
          <p className="mt-2 text-sm text-slate-600">
            주문을 준비한 뒤 기존 관리자 화면과 물류 앱에서 작업을 이어가세요.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/demo/manual/README" target="_blank" rel="noreferrer">
              직원 사용 가이드
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/inventory/replenishment">발주 추천</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/order/history">주문 조회</Link>
          </Button>
        </div>
      </div>
      {problems.map((problem, index) => (
        <p
          key={index}
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-800"
        >
          {(problem as Error).message}
        </p>
      ))}
      <section className="rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">시연 데이터 준비 상태</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${readiness.data?.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
          >
            {readiness.isLoading
              ? '확인 중'
              : readiness.data?.ready
                ? '준비 완료'
                : '준비 필요'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {readiness.data?.checks.map((check) => (
            <div key={check.key} className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">
                {(
                  {
                    products: '상품',
                    variants: '판매 옵션',
                    skus: 'SKU',
                    suppliers: '공급사',
                    warehouses: '창고',
                    locations: '위치',
                    demandDays: '수요 이력',
                    leadTimeObservations: '납기 이력',
                  } as Record<string, string>
                )[check.key] ?? check.key}
              </p>
              <p className="mt-1 font-semibold">
                {check.actual.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {check.expected.toLocaleString()}
                </span>
              </p>
            </div>
          ))}
        </div>
        {!readiness.isLoading && !readiness.data?.ready && (
          <p className="mt-3 text-sm text-amber-800">
            기준 데이터 준비가 필요합니다. 환경 관리자가 시연 기준 데이터 준비를
            완료하면 주문을 생성할 수 있습니다.
          </p>
        )}
      </section>
      {readiness.data?.coverage && (
        <section className="rounded-xl bg-slate-50 p-5 text-sm">
          {readiness.data.coverage.imported && (
            <p className="mb-2">
              운영 상품 복사:{' '}
              {readiness.data.coverage.imported.importedSkuCount.toLocaleString()}{' '}
              /{' '}
              {readiness.data.coverage.imported.sourceSkuCount.toLocaleString()}{' '}
              SKU · 누락 {readiness.data.coverage.imported.missingSkuCount}개 ·{' '}
              {new Date(
                readiness.data.coverage.imported.importedAt
              ).toLocaleString('ko-KR')}
            </p>
          )}
          <h2 className="font-semibold">전체 상품 기준정보</h2>
          <p className="mt-2">
            SKU {readiness.data.coverage.totalSkus.toLocaleString()}개 · 비삭제{' '}
            {readiness.data.coverage.activeSkus.toLocaleString()}개 · 공급처
            미연결 {readiness.data.coverage.withoutSupplier.toLocaleString()}개
            · 바코드 없음{' '}
            {readiness.data.coverage.withoutBarcode.toLocaleString()}개
          </p>
          <p className="mt-1 text-slate-500">
            위의 준비 상태는 기본 시연 세트 기준입니다. 주문 후보에는 현재 주문
            가능한 물리 상품만 표시합니다.
          </p>
        </section>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <DemoOrderForm
        ready={!!readiness.data?.ready}
        busy={busy || !!practicePending || !!replenishmentPending}
        pending={!!pending}
        loadCatalog={(query) =>
          request<{ items: CatalogItem[]; total: number }>(
            `core/catalog?${query}`
          )
        }
        onPrepareReplenishment={(input) => void prepareReplenishment(input)}
        onSubmit={(input) => void submit(input)}
        onPrepare={(items, prepareDemand) =>
          void prepare({ requestId: crypto.randomUUID(), items, prepareDemand })
        }
      />
      {replenishmentPending && (
        <section className="rounded-xl border border-amber-300 p-5 text-sm">
          <p>
            발주 제안 생성 결과를 확인해야 합니다. 같은 요청으로 재확인하면
            상품을 다시 추첨하거나 수요 이력을 중복 생성하지 않습니다.
          </p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={() => void prepareReplenishment(replenishmentPending)}
          >
            발주 제안 요청 재확인
          </Button>
        </section>
      )}
      {replenishmentResult && (
        <DemoReplenishmentResult result={replenishmentResult} />
      )}
      {practicePending && (
        <section className="rounded-xl border border-amber-300 p-5 text-sm">
          <p>
            보충 요청 결과를 확인해야 합니다. 같은 요청으로 재확인해도 재고를 두
            번 더하지 않습니다.
          </p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={() => void prepare(practicePending)}
          >
            보충 요청 재확인
          </Button>
        </section>
      )}
      {practiceResult && (
        <section className="rounded-xl bg-emerald-50 p-5 text-sm">
          <h2 className="font-semibold">시연 재고 준비 완료</h2>
          <p className="mt-2">
            {practiceResult.warehouseName} · {practiceResult.locationCode}
          </p>
          <p className="mt-1 break-all">입고번호: {practiceResult.receiptId}</p>
          <ul className="mt-2 space-y-1">
            {practiceResult.lines.map((line) => (
              <li key={line.skuId}>
                {line.name} · {line.sku} · +{line.quantity}개
              </li>
            ))}
          </ul>
          <p className="mt-2 text-slate-600">
            {practiceResult.demandPrepared
              ? '수요 이력 준비와 발주 추천 재계산을 완료했습니다.'
              : '입고·적치를 완료했습니다.'}
          </p>
        </section>
      )}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">생성 이력</h2>
        <p className="mt-1 text-sm text-slate-500">
          이벤트 접수 후 주문과 출고 작업 반영까지 잠시 걸릴 수 있습니다. 출고
          준비 상태는 주문 화면에서 확인하세요.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">생성 시각</th>
                <th>시나리오</th>
                <th>요청 / 접수 / 실패</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.data?.items.map((run) => (
                <tr key={run.id} className="border-b last:border-0">
                  <td className="py-3">
                    {new Date(run.createdAt).toLocaleString('ko-KR')}
                  </td>
                  <td>
                    {run.scenario === 'happy_path' ? '정상 출고' : '재고 부족'}
                  </td>
                  <td>
                    {run.summary.requested} / {run.summary.enqueued} /{' '}
                    {run.summary.failed}
                  </td>
                  <td>{statusLabels[run.status] ?? run.status}</td>
                  <td>
                    <Button variant="ghost" onClick={() => setSelected(run.id)}>
                      상세
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!runs.isLoading && !runs.data?.items.length && (
          <p className="py-6 text-center text-sm text-slate-500">
            아직 생성한 주문이 없습니다.
          </p>
        )}
      </section>
      {detail.data && (
        <section className="rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">생성 결과</h2>
            {['failed', 'partial_failure'].includes(detail.data.status) && (
              <Button
                variant="outline"
                disabled={busy || !!pending}
                onClick={() => void submit(retryRunInput(detail.data!))}
              >
                실패 항목 재시도
              </Button>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {detail.data.items?.map((item) => (
              <li key={item.id} className="rounded-md bg-slate-50 p-3 text-sm">
                <Link
                  className="font-mono underline"
                  href={`/order/history?externalOrderId=${encodeURIComponent(item.externalOrderId)}`}
                >
                  {item.externalOrderId}
                </Link>
                <span className="ml-3">
                  {statusLabels[item.status] ?? item.status}
                </span>
                {item.lines && (
                  <ul className="mt-2 space-y-1 text-slate-600">
                    {item.lines.map((line) => (
                      <li key={line.orderItemId}>
                        {line.productName} · {line.sku} · {line.quantity}개
                      </li>
                    ))}
                  </ul>
                )}
                {item.error && (
                  <p className="mt-1 text-red-700">{item.error}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">모의 판매채널 반영 이력</h2>
        <p className="mt-1 text-sm text-slate-500">
          출고·취소 등 외부 판매채널에 반영할 작업을 모의 처리한 결과입니다.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {dispatches.data?.items.map((item) => (
            <li key={item.id} className="rounded-md bg-slate-50 p-3">
              {new Date(item.createdAt).toLocaleString('ko-KR')} ·{' '}
              {item.channel} · {item.operation} · {item.status}
              {item.error && <p className="text-red-700">{item.error}</p>}
            </li>
          ))}
        </ul>
        {!dispatches.data?.items.length && (
          <p className="mt-4 text-sm text-slate-500">
            아직 처리 이력이 없습니다.
          </p>
        )}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-5">
          <h2 className="font-semibold">모의 택배 처리 이력</h2>
          <p className="mt-1 text-sm text-slate-500">
            송장 발행·접수·취소 기록입니다. 실제 택배사에 전달되지 않습니다.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {shipments.data?.items.map((item) => (
              <li key={item.reference} className="flex justify-between gap-2">
                <span className="font-mono">{item.trackingNumber}</span>
                <span>
                  {(
                    {
                      allocated: '번호 발급',
                      registered: '모의 접수',
                      canceled: '취소',
                    } as Record<string, string>
                  )[item.status] ?? item.status}
                </span>
              </li>
            ))}
          </ul>
          {!shipments.data?.items.length && (
            <p className="mt-4 text-sm text-slate-500">
              아직 처리 이력이 없습니다.
            </p>
          )}
        </div>
        <div className="rounded-xl border p-5">
          <h2 className="font-semibold">모의 알림 처리 이력</h2>
          <p className="mt-1 text-sm text-slate-500">
            실제 수신자에게 발송하지 않고 결과를 저장합니다.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {notifications.data?.logs.map((item) => (
              <li
                key={item.logId}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  {item.channel} ·{' '}
                  {new Date(item.createdAt).toLocaleTimeString('ko-KR')}
                </span>
                <span>{item.status}</span>
                {item.result && (
                  <details className="basis-full">
                    <summary className="cursor-pointer text-slate-500">
                      메시지 내용
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap">
                      {item.result.recipient} · {item.result.subject}
                      <br />
                      {item.result.content}
                    </p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {!notifications.data?.logs.length && (
            <p className="mt-4 text-sm text-slate-500">
              아직 처리 이력이 없습니다.
            </p>
          )}
        </div>
      </section>
      <section className="rounded-xl bg-slate-50 p-5">
        <h2 className="font-semibold">시연 동선</h2>
        <ol className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <li>1. 수요 이력 확인 → 발주 추천 → 발주서 확정</li>
          <li>2. 부분 입고 → 잔량 입고 → 적치·이동</li>
          <li>3. 주문 생성 → 송장 → 피킹·검수·출고</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium underline">
          <Link href="/inventory/purchase-orders">발주서</Link>
          <Link href="/inventory/inbound">입고</Link>
          <Link href="/inventory/movement">재고 이동</Link>
          <Link href="/order/waybill-issue">송장 발행</Link>
          <Link href="/order/outbound-batches">출고 배치</Link>
        </div>
      </section>
    </div>
  );
}
