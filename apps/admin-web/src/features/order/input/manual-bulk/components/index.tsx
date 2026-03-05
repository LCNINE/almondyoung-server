// src/features/order/input/manual-bulk/components/index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { Download, UploadCloud } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

type CsvRow = {
  orderNo: string;
  customerId: string;
  warehouseId: string;
  channelType?: 'linked' | 'unsupported' | '';
  channelId?: string;
  phoneOrderOwner?: string;
  recipientName?: string;
  recipientPhone?: string;
  zip?: string;
  addr1?: string;
  addr2?: string;
  msg?: string;
  skuId: string;
  quantity: string | number;
  unitPrice: string | number;
  memo?: string;
};

type OrderPayload = {
  orderNo: string;
  body: {
    customerId: string;
    warehouseId: string;
    items: { skuId: string; quantity: number; unitPrice: number }[];
    memo: string;
  };
};

const CSV_HEADER = [
  'orderNo',
  'customerId',
  'warehouseId',
  'channelType',
  'channelId',
  'phoneOrderOwner',
  'recipientName',
  'recipientPhone',
  'zip',
  'addr1',
  'addr2',
  'msg',
  'skuId',
  'quantity',
  'unitPrice',
  'memo',
].join(',');

const CSV_SAMPLE = [
  [
    'SO-20251001-0001',
    '33333333-3333-4333-8333-cccccccccccc',
    'WH-001',
    'linked',
    'shop-001',
    '',
    '홍길동',
    '010-1234-5678',
    '04524',
    '서울특별시 중구 세종대로 110',
    '지하1층',
    '부재시 문앞',
    'SKU-RED-M',
    2,
    15000,
    '첫 구매 고객',
  ].join(','),
  [
    'SO-20251001-0001',
    '33333333-3333-4333-8333-cccccccccccc',
    'WH-001',
    'linked',
    'shop-001',
    '',
    '홍길동',
    '010-1234-5678',
    '04524',
    '서울특별시 중구 세종대로 110',
    '지하1층',
    '부재시 문앞',
    'SKU-BLUE-L',
    1,
    17000,
    '',
  ].join(','),
  [
    'SO-20251001-0002',
    '99999999-9999-4999-8999-333333333333',
    'WH-002',
    'unsupported',
    '',
    '김담당',
    '신사임당',
    '010-9999-0000',
    '',
    '부산광역시 해운대구...',
    '',
    '',
    'SKU-ETC-01',
    3,
    12000,
    '전화주문',
  ].join(','),
].join('\n');

function parseNumber(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function safeTrim(v: unknown): string {
  return (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
}

export default function ManualBulkOrderPage() {
  const router = useRouter();
  const createOrder = useCreateSalesOrder();

  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [parsing, setParsing] = useState(false);

  // 제출 진행상태
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    done: number;
    ok: number;
    fail: number;
  }>({
    total: 0,
    done: 0,
    ok: 0,
    fail: 0,
  });
  const [results, setResults] = useState<
    { orderNo: string; status: 'ok' | 'fail'; message?: string }[]
  >([]);

  const grouped = useMemo(() => {
    // orderNo 기준 그룹핑 → 주문 payload 생성
    const map = new Map<string, CsvRow[]>();
    rows.forEach((r) => {
      const k = safeTrim(r.orderNo);
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });

    const orders: OrderPayload[] = [];
    for (const [orderNo, lines] of map.entries()) {
      const first = lines[0];
      const channelType =
        (safeTrim(first.channelType) as 'linked' | 'unsupported' | '') || '';
      const channelNote =
        channelType === 'linked'
          ? `CHANNEL_ID=${safeTrim(first.channelId)}`
          : channelType === 'unsupported'
          ? `PHONE_OWNER=${safeTrim(first.phoneOrderOwner)}`
          : '';

      const shipNoteParts = [
        safeTrim(first.addr1) || safeTrim(first.addr2)
          ? `SHIP_TO=${[safeTrim(first.addr1), safeTrim(first.addr2)]
              .filter(Boolean)
              .join(' / ')}`
          : '',
        safeTrim(first.zip) ? `ZIP=${safeTrim(first.zip)}` : '',
        safeTrim(first.msg) ? `REQ=${safeTrim(first.msg)}` : '',
      ].filter(Boolean);

      const items = lines.map((l) => ({
        skuId: safeTrim(l.skuId),
        quantity: parseNumber(l.quantity, 0),
        unitPrice: parseNumber(l.unitPrice, 0),
      }));

      const memo = [
        `ORDER_NO=${orderNo}`,
        channelNote,
        ...shipNoteParts,
        `QTY=${items.reduce(
          (a, b) => a + Number(b.quantity || 0),
          0
        )}, AMT=${items.reduce(
          (a, b) => a + Number(b.quantity || 0) * Number(b.unitPrice || 0),
          0
        )}`,
        safeTrim(first.memo) ? `MEMO=${safeTrim(first.memo)}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      orders.push({
        orderNo,
        body: {
          customerId: safeTrim(first.customerId),
          warehouseId: safeTrim(first.warehouseId),
          items,
          memo,
        },
      });
    }
    return orders;
  }, [rows]);

  const validation = useMemo(() => {
    const errs: string[] = [];
    if (rows.length === 0)
      return { ok: false, errors: ['CSV를 업로드하세요.'] };

    rows.forEach((r, i) => {
      const lineNo = i + 2; // 헤더 다음부터 2행
      if (!safeTrim(r.orderNo)) errs.push(`[${lineNo}행] orderNo 필수`);
      if (!safeTrim(r.customerId)) errs.push(`[${lineNo}행] customerId 필수`);
      if (!safeTrim(r.warehouseId)) errs.push(`[${lineNo}행] warehouseId 필수`);
      if (!safeTrim(r.skuId)) errs.push(`[${lineNo}행] skuId 필수`);
      if (parseNumber(r.quantity) <= 0)
        errs.push(`[${lineNo}행] quantity는 1 이상`);
      if (parseNumber(r.unitPrice) < 0)
        errs.push(`[${lineNo}행] unitPrice는 0 이상`);
    });

    return { ok: errs.length === 0, errors: errs };
  }, [rows]);

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_HEADER + '\n' + CSV_SAMPLE], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-order-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const normalizeRow = (o: any): CsvRow => ({
    orderNo: safeTrim(o.orderNo),
    customerId: safeTrim(o.customerId),
    warehouseId: safeTrim(o.warehouseId),
    channelType:
      (safeTrim(o.channelType) as 'linked' | 'unsupported' | '') || '',
    channelId: safeTrim(o.channelId),
    phoneOrderOwner: safeTrim(o.phoneOrderOwner),
    recipientName: safeTrim(o.recipientName),
    recipientPhone: safeTrim(o.recipientPhone),
    zip: safeTrim(o.zip),
    addr1: safeTrim(o.addr1),
    addr2: safeTrim(o.addr2),
    msg: safeTrim(o.msg),
    skuId: safeTrim(o.skuId),
    quantity: o.quantity,
    unitPrice: o.unitPrice,
    memo: safeTrim(o.memo),
  });

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    try {
      const text = await file.text();

      // dynamic import (클라 전용)
      let parsed: CsvRow[] = [];
      try {
        // papaparse 대신 간단한 CSV 파싱 사용
        const [headerLine, ...lines] = text.trim().split(/\r?\n/);
        const headers = headerLine.split(',').map((h) => h.trim());
        parsed = lines.filter(Boolean).map((line) => {
          const cols = line.split(',');
          const obj: any = {};
          headers.forEach((h, idx) => (obj[h] = cols[idx]));
          return normalizeRow(obj);
        });
      } catch (e) {
        // fallback: 아주 단순 CSV(쉼표만, 따옴표 미지원)
        const [headerLine, ...lines] = text.trim().split(/\r?\n/);
        const headers = headerLine.split(',').map((h) => h.trim());
        parsed = lines.filter(Boolean).map((line) => {
          const cols = line.split(',');
          const obj: any = {};
          headers.forEach((h, idx) => (obj[h] = cols[idx]));
          return normalizeRow(obj);
        });
      }

      setRows(parsed);
      toast.success(`${parsed.length}행 읽음`);
    } catch (e: any) {
      toast.error(e?.message || '파일을 확인하세요.');
      setRows([]);
    } finally {
      setParsing(false);
    }
  };

  const handleSubmitAll = async () => {
    if (!validation.ok) {
      toast.error('오류 목록을 확인하세요.');
      return;
    }
    setSubmitting(true);
    setResults([]);
    setProgress({ total: grouped.length, done: 0, ok: 0, fail: 0 });

    for (const ord of grouped) {
      try {
        await createOrder.mutateAsync(ord.body);
        setResults((r) => [{ orderNo: ord.orderNo, status: 'ok' }, ...r]);
        setProgress((p) => ({ ...p, done: p.done + 1, ok: p.ok + 1 }));
      } catch (e: any) {
        setResults((r) => [
          { orderNo: ord.orderNo, status: 'fail', message: e?.message },
          ...r,
        ]);
        setProgress((p) => ({ ...p, done: p.done + 1, fail: p.fail + 1 }));
      }
    }

    setSubmitting(false);

    toast(
      `성공 ${progress.ok + (grouped.length - progress.done)}건 / 실패 ${
        progress.fail
      }건`
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">주문입력(수동/대량)</h1>
          <p className="text-sm text-muted-foreground">
            CSV 양식으로 여러 건의 주문을 한 번에 생성합니다.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            샘플 CSV 다운로드
          </Button>
          <label className="inline-flex items-center">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = '';
              }}
            />
            <Button asChild variant="default">
              <span>
                <UploadCloud className="w-4 h-4 mr-2" />
                CSV 업로드
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* 업로드 정보 */}
      <Card className="p-4 space-y-2">
        <div className="text-sm">
          <span className="font-medium">선택된 파일:</span>{' '}
          {fileName ? (
            <span className="font-mono">{fileName}</span>
          ) : (
            <span className="text-muted-foreground">없음</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          필수 컬럼:{' '}
          <code>
            orderNo, customerId, warehouseId, skuId, quantity, unitPrice
          </code>{' '}
          — 같은 <code>orderNo</code>는 한 주문으로 묶입니다.
        </div>
      </Card>

      {/* 검증 결과 */}
      {!parsing && rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-3">검증</h2>
          {validation.ok ? (
            <div className="text-sm text-green-600">
              문제 없음. 총 {rows.length}행, 묶인 주문 {grouped.length}건
            </div>
          ) : (
            <ul className="list-disc pl-5 text-sm text-red-600 space-y-1">
              {validation.errors.map((e, idx) => (
                <li key={idx}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 미리보기 (그룹 요약) */}
      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4">
            <h2 className="text-lg font-semibold">그룹 요약</h2>
            <p className="text-xs text-muted-foreground">
              주문별 묶음 미리보기 (표는 각 주문의 첫 라인을 대표로 보여줍니다)
            </p>
          </div>
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>orderNo</TableHead>
                  <TableHead>customerId</TableHead>
                  <TableHead>warehouseId</TableHead>
                  <TableHead className="text-right">items</TableHead>
                  <TableHead className="text-right">총수량</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((g) => {
                  const qty = g.body.items.reduce((a, b) => a + b.quantity, 0);
                  const amt = g.body.items.reduce(
                    (a, b) => a + b.quantity * b.unitPrice,
                    0
                  );
                  return (
                    <TableRow key={g.orderNo}>
                      <TableCell className="font-mono">{g.orderNo}</TableCell>
                      <TableCell className="font-mono">
                        {g.body.customerId}
                      </TableCell>
                      <TableCell className="font-mono">
                        {g.body.warehouseId}
                      </TableCell>
                      <TableCell className="text-right">
                        {g.body.items.length}
                      </TableCell>
                      <TableCell className="text-right">
                        {qty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {amt.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {grouped.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      데이터 없음
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* 원본행 미리보기 */}
      {rows.length > 0 && (
        <Card className="p-0 overflow-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold">원본 행 미리보기</h2>
          </div>
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>orderNo</TableHead>
                  <TableHead>customerId</TableHead>
                  <TableHead>warehouseId</TableHead>
                  <TableHead>skuId</TableHead>
                  <TableHead className="text-right">quantity</TableHead>
                  <TableHead className="text-right">unitPrice</TableHead>
                  <TableHead>memo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 200).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell className="font-mono">{r.customerId}</TableCell>
                    <TableCell className="font-mono">{r.warehouseId}</TableCell>
                    <TableCell className="font-mono">{r.skuId}</TableCell>
                    <TableCell className="text-right">
                      {parseNumber(r.quantity).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {parseNumber(r.unitPrice).toLocaleString()}
                    </TableCell>
                    <TableCell className="truncate max-w-[280px]">
                      {r.memo}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length > 200 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground py-3"
                    >
                      …외 {rows.length - 200}행 더 있음
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* 제출 영역 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {submitting
            ? `진행 ${progress.done}/${progress.total} — 성공 ${progress.ok}, 실패 ${progress.fail}`
            : rows.length > 0
            ? `총 ${grouped.length}건 주문 생성 준비`
            : 'CSV를 업로드하면 여기서 진행상황을 볼 수 있어요.'}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/order/history')}
          >
            주문내역으로
          </Button>
          <Button
            disabled={
              parsing || submitting || rows.length === 0 || !validation.ok
            }
            onClick={handleSubmitAll}
          >
            {submitting ? '생성 중…' : `일괄 생성 (${grouped.length}건)`}
          </Button>
        </div>
      </div>

      {/* 결과 로그 */}
      {results.length > 0 && (
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-3">결과</h2>
          <div className="max-h-64 overflow-auto text-sm font-mono space-y-1">
            {results.map((r, idx) => (
              <div
                key={idx}
                className={
                  r.status === 'ok' ? 'text-green-700' : 'text-red-700'
                }
              >
                [{r.status.toUpperCase()}] {r.orderNo}{' '}
                {r.message ? `- ${r.message}` : ''}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
