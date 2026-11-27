// src/features/order/input/manual-bulk/components/index.tsx
'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CanOpen } from '@/components/auth/can';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCreateSalesOrder } from '@/lib/services/orders';
import { useVariantsBatch } from '@/lib/services/products';
import { Download, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BULK_ORDER_COLUMNS,
  CSV_BOM,
  groupBulkOrders,
  readBulkOrderCsv,
  toCsv,
  variantIdsOf,
  type BulkOrder,
  type BulkRow,
  type VariantLookup,
} from '../../lib/bulk-order-csv';
import { describeSaveError } from '../../lib/manual-order';

type SaveResult =
  | { status: 'saved'; orderId?: string }
  | { status: 'duplicate'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'unknown'; message: string };

type SaveAttempt = {
  fileName: string;
  rowCount: number;
  orderCount: number;
  results: { orderNo: string; result: SaveResult }[];
};

const countResults = (results: SaveResult[]) => ({
  saved: results.filter((result) => result.status === 'saved').length,
  duplicate: results.filter((result) => result.status === 'duplicate').length,
  failed: results.filter((result) => result.status === 'failed').length,
  unknown: results.filter((result) => result.status === 'unknown').length,
});

const SAMPLE_ROWS = [
  [
    'SO-20260101-0001',
    '',
    '주문자',
    '010-0000-0000',
    '',
    '받는 분',
    '010-0000-0000',
    '00000',
    '도로명 주소',
    '101호',
    '문 앞',
    '옵션 ID 를 붙여 넣으세요',
    1,
    1000,
    '전화 접수',
  ],
];

const COLUMN_GUIDE: { column: string; note: string }[] = [
  {
    column: 'orderNo *',
    note: '주문번호. 같은 번호의 행은 한 주문으로 묶이고, 한 번만 저장됩니다.',
  },
  { column: 'customerId', note: '회원이면 고객 ID, 아니면 비워 둡니다.' },
  { column: 'buyerName · buyerPhone · buyerEmail', note: '주문자 정보 (선택)' },
  { column: 'recipientName · recipientPhone *', note: '받는 분 이름·연락처' },
  {
    column: 'zip · addr1 · addr2 *',
    note: "우편번호·주소·상세 주소. 상세 주소가 없으면 '없음'",
  },
  { column: 'msg', note: '배송 메모 (선택)' },
  {
    column: 'variantId *',
    note: '판매상품 옵션 ID. 업로드하면 상품 이름으로 바로 확인됩니다.',
  },
  {
    column: 'quantity · unitPrice *',
    note: '수량(1 이상 정수)·단가(원, 무상이면 0)',
  },
  { column: 'memo', note: '주문 메모 (선택)' },
];

const variantLabel = (v: {
  masterName: string;
  optionLabel?: string;
  variantName?: string;
}) => {
  const option = v.optionLabel || v.variantName;
  return option && option !== v.masterName
    ? `${v.masterName} / ${option}`
    : v.masterName;
};

export default function ManualBulkOrderPage() {
  const createOrder = useCreateSalesOrder();

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [fileIssues, setFileIssues] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<Record<string, SaveResult>>({});
  const [attempts, setAttempts] = useState<SaveAttempt[]>([]);
  const loadRef = useRef(0);
  const loadingRef = useRef(false);
  const submittingRef = useRef(false);

  const ids = useMemo(() => variantIdsOf(rows), [rows]);
  const variantsQuery = useVariantsBatch(ids);
  const lookup: VariantLookup | null = useMemo(() => {
    if (ids.length === 0) return new Map();
    if (!variantsQuery.data) return null;
    const map: VariantLookup = new Map();
    variantsQuery.data.forEach((v, id) =>
      map.set(id, { label: variantLabel(v) })
    );
    return map;
  }, [ids.length, variantsQuery.data]);

  const orders = useMemo(() => groupBulkOrders(rows, lookup), [rows, lookup]);
  const issues = orders.flatMap((o) => o.issues);
  const checking = ids.length > 0 && variantsQuery.isPending;
  const ready = rows.length > 0 && issues.length === 0 && lookup !== null;
  const pendingOrders = orders.filter(
    (o) =>
      o.payload &&
      results[o.orderNo]?.status !== 'saved' &&
      results[o.orderNo]?.status !== 'duplicate'
  );

  const handleDownloadTemplate = () => {
    const csv = CSV_BOM + toCsv([[...BULK_ORDER_COLUMNS], ...SAMPLE_ROWS]);
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-order-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    if (submittingRef.current) return;
    // 읽는 동안 이전 파일로 저장을 시작하지 못하게 미리보기를 먼저 비운다
    const load = ++loadRef.current;
    loadingRef.current = true;
    setFileName(file.name);
    setResults({});
    setRows([]);
    setFileIssues([]);
    const read = readBulkOrderCsv(await file.text());
    if (load !== loadRef.current) return;
    setRows(read.rows);
    setFileIssues(read.fileIssues);
    loadingRef.current = false;
  };

  const saveOne = async (order: BulkOrder): Promise<SaveResult> => {
    if (!order.payload)
      return { status: 'failed', message: '검증되지 않은 주문입니다.' };
    try {
      const saved = await createOrder.mutateAsync(order.payload);
      return { status: 'saved', orderId: saved.id };
    } catch (err) {
      const { kind, message } = describeSaveError(err);
      if (kind === 'duplicate') return { status: 'duplicate', message };
      if (kind === 'retry') return { status: 'unknown', message };
      return { status: 'failed', message };
    }
  };

  // 한 건씩 차례로 저장한다. 실패해도 멈추지 않고, 이미 저장된 번호는 다시 만들지 않는다.
  const handleSave = async () => {
    if (
      !ready ||
      loadingRef.current ||
      submittingRef.current ||
      pendingOrders.length === 0
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    const load = loadRef.current;
    const attempted: SaveAttempt['results'] = [];
    for (const order of pendingOrders) {
      if (load !== loadRef.current) break;
      const result = await saveOne(order);
      attempted.push({ orderNo: order.orderNo, result });
      setResults((prev) => ({ ...prev, [order.orderNo]: result }));
    }
    setAttempts((prev) => [
      {
        fileName,
        rowCount: rows.length,
        orderCount: orders.length,
        results: attempted,
      },
      ...prev,
    ]);
    submittingRef.current = false;
    setSubmitting(false);
    const counts = countResults(attempted.map(({ result }) => result));
    const summary = `저장 ${counts.saved}건 · 기존 번호 중복 ${counts.duplicate}건 · 실패 ${counts.failed}건 · 결과 미확인 ${counts.unknown}건`;
    if (counts.failed > 0 || counts.unknown > 0) toast.error(summary);
    else if (counts.duplicate > 0) toast.info(summary);
    else toast.success(summary);
  };

  const currentCounts = countResults(Object.values(results));
  const savedOnce = Object.keys(results).length > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">주문입력(수동/대량)</h1>
          <p className="text-sm text-muted-foreground">
            CSV 로 여러 주문을 한 번에 저장합니다. 수기·기타 채널로 저장되고,
            저장된 주문은 출고 대기열에 등록됩니다. 이 화면의 결과 내역은
            페이지를 떠나면 사라집니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            양식 내려받기
          </Button>
          <label className="inline-flex items-center">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={submitting}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.currentTarget.value = '';
              }}
            />
            <Button asChild variant="default" disabled={submitting}>
              <span aria-disabled={submitting}>
                <UploadCloud className="w-4 h-4 mr-2" />
                CSV 업로드
              </span>
            </Button>
          </label>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-sm">
          <span className="font-medium">선택된 파일:</span>{' '}
          {fileName ? (
            <span className="font-mono break-all">{fileName}</span>
          ) : (
            <span className="text-muted-foreground">없음</span>
          )}
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {COLUMN_GUIDE.map((g) => (
            <li key={g.column}>
              <code className="text-foreground">{g.column}</code> — {g.note}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">* 는 필수 열입니다.</p>
      </Card>

      {(fileIssues.length > 0 || rows.length > 0) && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-semibold">검증</h2>
          {fileIssues.length > 0 ? (
            <ul
              role="alert"
              className="pl-5 space-y-1 text-sm list-disc text-destructive"
            >
              {fileIssues.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : checking ? (
            <p className="text-sm text-muted-foreground">
              상품을 확인하는 중...
            </p>
          ) : variantsQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              상품 정보를 확인하지 못했습니다.{' '}
              <Button
                size="sm"
                variant="outline"
                onClick={() => variantsQuery.refetch()}
              >
                다시 확인
              </Button>
            </p>
          ) : issues.length > 0 ? (
            <>
              <p className="text-sm text-destructive">
                고칠 곳 {issues.length}개. 파일을 고친 뒤 다시 올려 주세요.
                문제가 있는 파일은 한 건도 저장하지 않습니다.
              </p>
              <ul
                role="alert"
                className="pl-5 space-y-1 text-sm list-disc text-destructive"
              >
                {issues.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-green-700">
              문제 없음. 빈 행 제외 {rows.length}행, 주문 {orders.length}건
            </p>
          )}
        </Card>
      )}

      {fileIssues.length === 0 && orders.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4">
            <h2 className="text-lg font-semibold">주문 미리보기</h2>
          </div>
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>주문번호</TableHead>
                  <TableHead>받는 분</TableHead>
                  <TableHead>상품</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                  <TableHead>저장</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.orderNo || 'missing'}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {o.orderNo || '(주문번호 없음)'}
                      <div className="text-xs text-muted-foreground">
                        {o.lineNos.join(', ')}행
                      </div>
                    </TableCell>
                    <TableCell>
                      {o.payload?.shippingAddress.recipientName ?? '-'}
                    </TableCell>
                    <TableCell>
                      {o.payload ? (
                        <ul className="text-sm">
                          {o.payload.lines.map((l, i) => (
                            <li key={i}>
                              {l.productName} × {l.quantity}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm text-destructive">
                          검증 필요
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {o.payload
                        ? `${(o.payload.totalAmount ?? 0).toLocaleString('ko-KR')}원`
                        : '-'}
                    </TableCell>
                    <TableCell className="min-w-[10rem] whitespace-normal text-sm">
                      <ResultCell
                        orderNo={o.orderNo}
                        result={results[o.orderNo]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!ready || submitting || pendingOrders.length === 0}
        >
          {submitting
            ? '저장 중...'
            : savedOnce &&
                (currentCounts.failed > 0 || currentCounts.unknown > 0)
              ? `실패·미확인 ${pendingOrders.length}건 다시 시도`
              : `${pendingOrders.length}건 저장`}
        </Button>
      </div>

      {attempts.length > 0 && (
        <Card className="p-4 space-y-4">
          <h2 className="text-lg font-semibold">저장 시도 내역</h2>
          <p className="text-sm text-muted-foreground">
            새 파일은 모든 유효 주문을 다시 시도합니다. 같은 주문번호라도 이전
            파일과 내용이 같다고 판단하지 않습니다. 중복·결과 미확인은
            주문내역에서 기존 주문의 내용과 출고 상태를 확인해 주세요.
          </p>
          {attempts.map((attempt, index) => {
            const counts = countResults(
              attempt.results.map(({ result }) => result)
            );

            return (
              <div
                key={attempts.length - index}
                className="space-y-2 border-t pt-3"
              >
                <h3 className="font-medium break-all">
                  시도 {attempts.length - index} · {attempt.fileName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  빈 행 제외 {attempt.rowCount}행 · 묶인 주문{' '}
                  {attempt.orderCount}건 · 이번 시도 {attempt.results.length}건
                </p>
                <p className="text-sm">
                  저장 {counts.saved}건 · 기존 번호 중복 {counts.duplicate}건 ·
                  실패 {counts.failed}건 · 결과 미확인 {counts.unknown}건
                </p>
                <ul className="space-y-2 text-sm">
                  {attempt.results.map(({ orderNo, result }) => (
                    <li key={orderNo} className="flex flex-wrap gap-x-3">
                      <span className="font-mono break-all">{orderNo}</span>
                      <ResultCell orderNo={orderNo} result={result} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function ResultCell({
  orderNo,
  result,
}: {
  orderNo: string;
  result?: SaveResult;
}) {
  if (!result) return <span className="text-muted-foreground">저장 전</span>;
  if (result.status === 'saved')
    return (
      <span className="text-green-700">
        저장됨{' '}
        {result.orderId && (
          <CanOpen screen="/cs">
            <Link
              className="text-primary underline underline-offset-2"
              href={`/cs?orderId=${encodeURIComponent(result.orderId)}&orderNo=${encodeURIComponent(orderNo)}`}
            >
              생성 주문 열기
            </Link>
          </CanOpen>
        )}
      </span>
    );
  if (result.status === 'duplicate')
    return (
      <span className="text-muted-foreground">
        기존 번호 중복 — 저장하지 않음. 내용은 확인 필요.{' '}
        <CanOpen screen="/order/history">
          <Link
            className="text-primary underline underline-offset-2"
            href={`/order/history?orderNo=${encodeURIComponent(orderNo)}`}
          >
            주문내역에서 확인
          </Link>
        </CanOpen>
      </span>
    );
  if (result.status === 'unknown')
    return (
      <span className="text-amber-700">
        결과 미확인 — {result.message}{' '}
        <CanOpen screen="/order/history">
          <Link
            className="text-primary underline underline-offset-2"
            href={`/order/history?orderNo=${encodeURIComponent(orderNo)}`}
          >
            주문내역에서 확인
          </Link>
        </CanOpen>
      </span>
    );
  return <span className="text-destructive">실패 — {result.message}</span>;
}
