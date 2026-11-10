// src/features/order/input/manual-bulk/components/index.tsx
'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  | { status: 'saved' }
  | { status: 'duplicate'; message: string }
  | { status: 'failed'; message: string };

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
  const loadRef = useRef(0);

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
    // 저장 중에 파일을 바꾸면 진행 중인 결과가 새 파일의 주문에 붙는다
    if (submitting) return;
    // 읽는 동안 이전 파일로 저장을 시작하지 못하게 미리보기를 먼저 비운다
    const load = ++loadRef.current;
    setFileName(file.name);
    setResults({});
    setRows([]);
    setFileIssues([]);
    const read = readBulkOrderCsv(await file.text());
    if (load !== loadRef.current) return;
    setRows(read.rows);
    setFileIssues(read.fileIssues);
  };

  const saveOne = async (order: BulkOrder): Promise<SaveResult> => {
    if (!order.payload)
      return { status: 'failed', message: '검증되지 않은 주문입니다.' };
    try {
      await createOrder.mutateAsync(order.payload);
      return { status: 'saved' };
    } catch (err) {
      const { kind, message } = describeSaveError(err);
      return kind === 'duplicate'
        ? { status: 'duplicate', message }
        : { status: 'failed', message };
    }
  };

  // 한 건씩 차례로 저장한다. 실패해도 멈추지 않고, 이미 저장된 번호는 다시 만들지 않는다.
  const handleSave = async () => {
    if (!ready || pendingOrders.length === 0) return;
    setSubmitting(true);
    let saved = 0;
    let failed = 0;
    const load = loadRef.current;
    for (const order of pendingOrders) {
      if (load !== loadRef.current) break;
      const result = await saveOne(order);
      if (result.status === 'saved') saved += 1;
      if (result.status === 'failed') failed += 1;
      setResults((prev) => ({ ...prev, [order.orderNo]: result }));
    }
    setSubmitting(false);
    if (failed > 0)
      toast.error(
        `저장 ${saved}건, 실패 ${failed}건. 실패한 주문만 다시 저장할 수 있습니다.`
      );
    else toast.success(`${saved}건을 저장했습니다. 출고 준비로 넘어갑니다.`);
  };

  const failedCount = Object.values(results).filter(
    (r) => r.status === 'failed'
  ).length;
  const savedOnce = Object.keys(results).length > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">주문입력(수동/대량)</h1>
          <p className="text-sm text-muted-foreground">
            CSV 로 여러 주문을 한 번에 저장합니다. 수기·기타 채널로 저장되고,
            저장하면 바로 출고 준비로 넘어갑니다.
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
              문제 없음. 총 {rows.length}행, 주문 {orders.length}건
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
                      <ResultCell result={results[o.orderNo]} />
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
            : savedOnce && failedCount > 0
              ? `실패한 ${pendingOrders.length}건 다시 저장`
              : `${pendingOrders.length}건 저장`}
        </Button>
      </div>
    </div>
  );
}

function ResultCell({ result }: { result?: SaveResult }) {
  if (!result) return <span className="text-muted-foreground">저장 전</span>;
  if (result.status === 'saved')
    return <span className="text-green-700">저장됨</span>;
  if (result.status === 'duplicate')
    return (
      <span className="text-muted-foreground" title={result.message}>
        이미 저장된 주문번호 — 다시 만들지 않음
      </span>
    );
  return <span className="text-destructive">실패 — {result.message}</span>;
}
